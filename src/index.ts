import https from "https";

import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobServiceClient,
  ContainerSASPermissions,
  generateBlobSASQueryParameters,
  SASProtocol,
} from "@azure/storage-blob";
import { readFileSync } from "fs";

import dotenv from "dotenv";

dotenv.config();

const StorageAccount = process.env.STORAGE_ACCOUNT;
const StorageContainer = process.env.BLOB_CONTAINER;
const SslKey = process.env.SSL_KEY;
const SslCert = process.env.SSL_CERT;
const SslPassphrase = process.env.SSL_PASSPHRASE;
const SslHost = process.env.SSL_HOST;

if (!StorageAccount || !StorageContainer || !SslKey || !SslCert || !SslPassphrase || !SslHost) {
  throw new Error("make sure to set up your .env file");
}

async function getReadOnlySasQueryParameter(account: string, container: string) {
  const creds = new DefaultAzureCredential();
  const blobStorageUrl = `https://${account}.blob.core.windows.net/`;
  const blobStorage = new BlobServiceClient(blobStorageUrl, creds);

  const userDelegationKey = await blobStorage.getUserDelegationKey(new Date(), new Date(new Date().getTime() + 100000));
  const sasQueryParams = generateBlobSASQueryParameters(
    {
      containerName: container,
      permissions: ContainerSASPermissions.parse("r"), // Required
      startsOn: new Date(), // Optional
      expiresOn: new Date(new Date().valueOf() + 86400), // Required. Date type
      ipRange: { start: "0.0.0.0", end: "255.255.255.255" }, // Optional
      protocol: SASProtocol.Https, // Optional
    },
    userDelegationKey,
    account
  );

  return sasQueryParams.toString();
}

(async () => {
  const sasQueryParams = await getReadOnlySasQueryParameter(StorageAccount, StorageContainer);
  const app = express();

  app.use(
    "/" + StorageContainer,
    createProxyMiddleware({
      target: `https://${StorageAccount}.blob.core.windows.net`,
      changeOrigin: true,
      pathRewrite: (path) => {
        console.log(`rewriting to ${path + "?" + sasQueryParams}`);
        return path + "?" + sasQueryParams;
      },
    })
  );

  const httpsServer = https.createServer(
    {
      key: readFileSync(SslKey, "utf-8"),
      cert: readFileSync(SslCert, "utf-8"),
      passphrase: SslPassphrase,
    },
    app
  );
  httpsServer.listen(
    {
      host: "local.teams.office.com",
      port: 443,
    },
    () => {
      console.log("source-maps proxy service live");
    }
  );
})();
