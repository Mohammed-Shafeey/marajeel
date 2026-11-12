// طائرة المراجيل — Azure infrastructure.
// Static Web App (frontend + managed .NET 8 isolated Functions API), Azure SQL serverless (free offer),
// and a private Blob Storage account for player photos.
//
//   az group create -n rg-marajeel -l westeurope
//   az deployment group create -g rg-marajeel -f infra/main.bicep -p sqlAdminPassword='<strong password>'

@description('Short name used to derive resource names.')
@minLength(3)
@maxLength(12)
param appName string = 'marajeel'

@description('Region for SQL and Storage.')
param location string = resourceGroup().location

@description('Static Web Apps is only offered in a few regions.')
@allowed(['westeurope', 'eastus2', 'centralus', 'westus2', 'eastasia'])
param swaLocation string = 'westeurope'

@description('SQL administrator login (SQL auth is required: SWA managed functions cannot use managed identity).')
param sqlAdminLogin string = 'marajeeladmin'

@secure()
@description('SQL administrator password.')
param sqlAdminPassword string

@description('Static Web Apps plan. Free supports custom roles via invitations and managed functions.')
@allowed(['Free', 'Standard'])
param swaSku string = 'Free'

var suffix = uniqueString(resourceGroup().id)
var storageName = toLower('st${appName}${take(suffix, 8)}')
var sqlServerName = 'sql-${appName}-${take(suffix, 6)}'

// ---- Storage (photos) ----------------------------------------------------------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false // photos are served through the API proxy
    supportsHttpsTrafficOnly: true
    accessTier: 'Hot'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource photos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'photos'
  properties: { publicAccess: 'None' }
}

// ---- Azure SQL (serverless, free offer) -----------------------------------------------------------
resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// SWA managed functions have no fixed outbound IPs, so allow Azure services.
resource allowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: appName
  location: location
  sku: { name: 'GP_S_Gen5', tier: 'GeneralPurpose', family: 'Gen5', capacity: 2 }
  properties: {
    // Azure SQL Database free offer: 100k vCore-seconds + 32 GB per month, pauses when used up.
    useFreeLimit: true
    freeLimitExhaustionBehavior: 'AutoPause'
    autoPauseDelay: 60
    minCapacity: json('0.5')
    maxSizeBytes: 34359738368
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
  }
}

// ---- Static Web App --------------------------------------------------------------------------------
resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'swa-${appName}-${take(suffix, 6)}'
  location: swaLocation
  sku: { name: swaSku, tier: swaSku }
  properties: {
    // Deployed by GitHub Actions with the deployment token (see .github/workflows/deploy.yml).
    buildProperties: { skipGithubActionWorkflowGeneration: true }
  }
}

resource swaSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    SQL_CONNECTION: 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Database=${sqlDb.name};User ID=${sqlAdminLogin};Password=${sqlAdminPassword};Encrypt=True;TrustServerCertificate=False;Connection Timeout=60;'
    BLOB_CONNECTION: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
  }
}

output staticWebAppName string = swa.name
output staticWebAppUrl string = 'https://${swa.properties.defaultHostname}'
output sqlServer string = sqlServer.properties.fullyQualifiedDomainName
output storageAccount string = storage.name
