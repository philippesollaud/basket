param(
    [Parameter(Mandatory = $true)]
    [string] $SubscriptionId,
    [string] $ResourceGroup = 'rg-basket-u11',
    [string] $AppName = 'swa-basket-u11'
)

$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'La compilation a échoué. Aucun déploiement effectué.' }

    $token = & az staticwebapp secrets list `
        --subscription $SubscriptionId --resource-group $ResourceGroup --name $AppName `
        --query properties.apiKey --output tsv --only-show-errors
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
        throw 'Impossible de récupérer le jeton Azure de déploiement.'
    }

    $previousToken = $env:SWA_CLI_DEPLOYMENT_TOKEN
    try {
        $env:SWA_CLI_DEPLOYMENT_TOKEN = $token.Trim()
        & npx --yes --package '@azure/static-web-apps-cli@2.1.0' swa deploy '.\dist' `
            --env production --no-use-keychain
        if ($LASTEXITCODE -ne 0) { throw 'Le déploiement Azure a échoué.' }
    }
    finally {
        $env:SWA_CLI_DEPLOYMENT_TOKEN = $previousToken
        $token = $null
    }
}
finally {
    Pop-Location
}
