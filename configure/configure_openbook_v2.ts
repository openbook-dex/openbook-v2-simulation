import { command, number, option, string, run, boolean, flag } from "cmd-ts";

import * as fs from "fs";
import * as os from "os";

import programs from "./programs.json";
import {
  Commitment,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { getKeypairFromFile } from "./common_utils";
import { User, createUser, mintUser } from "./general/create_users";
import { configure_accounts } from "./general/accounts";
import { OutputFile } from "./output_file";
import { MintUtils } from "./general/mint_utils";
import { OpenbookConfigurator } from "./openbook-v2/configure_openbook";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const endpoint = option({
  type: string,
  defaultValue: () => "http://127.0.0.1:8899",
  long: "url",
  short: "u",
  description: "RPC url",
});

const authority = option({
  type: string,
  defaultValue: () => `${os.homedir()}/.config/solana/id.json`,
  long: "authority",
  short: "a",
});

const nbPayers = option({
  type: number,
  defaultValue: () => 10,
  long: "number-of-payers",
  short: "p",
  description: "Number of payers used for testing",
});

const balancePerPayer = option({
  type: number,
  defaultValue: () => 1,
  long: "payer-balance",
  short: "b",
  description: "Balance of payer in SOLs",
});

const nbMints = option({
  type: number,
  defaultValue: () => 10,
  long: "number-of-mints",
  short: "m",
  description: "Number of mints",
});

const nbMarkerOrderPerSide = option({
  type: number,
  defaultValue: () => 10,
  long: "number-of-market-orders-per-user",
  short: "o",
  description: "Number of of market orders per user on each side",
});

const skipProgramDeployment = flag({
  type: boolean,
  defaultValue: () => false,
  long: "skip-program-deployment",
  short: "s",
  description: "Skip deploying programs",
});

const outFile = option({
  type: string,
  defaultValue: () => "configure/config.json",
  long: "output-file",
  short: "o",
});

const app = command({
  name: "configure",
  args: {
    endpoint,
    authority,
    nbPayers,
    balancePerPayer,
    nbMints,
    skipProgramDeployment,
    nbMarkerOrderPerSide,
    outFile,
  },
  handler: ({
    endpoint,
    authority,
    nbPayers,
    balancePerPayer,
    nbMints,
    skipProgramDeployment,
    nbMarkerOrderPerSide,
    outFile,
  }) => {
    console.log("configuring a new test instance");
    configure(
      endpoint,
      authority,
      nbPayers,
      balancePerPayer,
      nbMints,
      skipProgramDeployment,
      nbMarkerOrderPerSide,
      outFile
    ).then((_) => {
      console.log("configuration finished");
    });
  },
});

run(app, process.argv.slice(2));

// configure part
async function configure(
  endpoint: String,
  authorityFile: String,
  nbPayers: number,
  balancePerPayer: number,
  nbMints: number,
  skipProgramDeployment: boolean,
  nbMarkerOrderPerSide: number,
  outFile: String
) {
  // create connections
  const connection = new Connection(
    endpoint.toString(),
    "confirmed" as Commitment
  );

  // configure authority
  const authority = getKeypairFromFile(authorityFile);
  const authorityBalance = await connection.getBalance(authority.publicKey);
  const requiredBalance =
    nbPayers * (balancePerPayer * LAMPORTS_PER_SOL) + 100 * LAMPORTS_PER_SOL;
  if (authorityBalance < requiredBalance) {
    console.log(
      "authority may have low balance balance " +
        authorityBalance +
        " required balance " +
        requiredBalance
    );
  }

  let programOutputData = programs.map((x) => {
    let kp = getKeypairFromFile(x.programKeyPath);
    let program_id;
    if (x.id != "") {
      program_id = new PublicKey(x.id);
    } else {
      program_id = kp.publicKey;
    }
    console.log("program " + x.name + " -> " + program_id.toString());
    return {
      name: x.name,
      program_id,
    };
  });

  let programIds = programOutputData.map((x) => {
    return x.program_id;
  });

  console.log("Creating Mints");
  let mintUtils = new MintUtils(connection, authority);
  let mints = await mintUtils.createMints(nbMints);
  console.log("Mints created");

  await delay(2000);

  console.log("Configuring openbook-v2");
  let index = programs.findIndex((x) => x.name === "openbook_v2");
  let openbookProgramId = programOutputData[index].program_id;
  let openbookConfigurator = new OpenbookConfigurator(
    connection,
    authority,
    mintUtils,
    openbookProgramId
  );
  let markets = await openbookConfigurator.configureOpenbookV2(mints);
  console.log("Finished configuring openbook");

  console.log("Creating users");

  const chunkSize = 10;
  console.log("creating " + nbPayers + " in batches of " + chunkSize);
  let userData: User[] = [];

  for (let i = 0; i < nbPayers; i += chunkSize) {
    let users = await Promise.all(
      Array.from(Array(chunkSize).keys()).map((_) =>
        createUser(connection, authority, balancePerPayer)
      )
    );
    let tokenAccounts = await Promise.all(
      users.map(
        /// user is richer than bill gates, but not as rich as certain world leaders
        async (user) =>
          await mintUser(
            connection,
            authority,
            mints,
            mintUtils,
            user.publicKey,
            100_000_000_000_000_000
          )
      )
    );

    let userOpenOrders = await Promise.all(
      users.map(
        /// user is crazy betting all his money in crypto market
        async (user) =>
          await openbookConfigurator.configureMarketForUser(user, markets)
      )
    );

    let userDataBatch = users.map((user, i) => {
      return {
        secret: Array.from(user.secretKey),
        open_orders: userOpenOrders[i],
        token_data: tokenAccounts[i],
      };
    });

    userData = userData.concat(userDataBatch);

    console.log("Users created");

    console.log("Filling up orderbook");
    await Promise.all(
      userDataBatch.map(async (user, i) => {
        for (const market of markets) {
          await openbookConfigurator.fillOrderBook(
            user,
            users[i],
            market,
            nbMarkerOrderPerSide
          );
        }
      })
    );
    console.log("Orderbook filled");
  }

  let accounts: PublicKey[] = [];
  // adding known accounts
  const marketAccountsList = markets
    .map((market) => [
      market.asks,
      market.bids,
      market.market_pk,
      market.oracle_a,
      market.oracle_b,
      market.quote_vault,
      market.base_vault,
      market.base_mint,
      market.quote_mint,
    ])
    .flat();
  const userAccountsList = userData
    .map((user) => {
      const allOpenOrdersAccounts = user.open_orders
        .map((x) => x.open_orders)
        .flat();
      const allTokenAccounts = user.token_data.map((x) => x.token_account);
      return allOpenOrdersAccounts.concat(allTokenAccounts);
    })
    .flat();
  accounts = accounts.concat(marketAccountsList).concat(userAccountsList);

  console.log("Accounts created");

  let outputFile: OutputFile = {
    programs: programOutputData,
    known_accounts: accounts,
    users: userData,
    mints,
    markets,
  };

  console.log("creating output file");
  fs.writeFileSync(outFile.toString(), JSON.stringify(outputFile, null, 2));
}
