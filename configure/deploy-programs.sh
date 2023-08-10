#! /bin/bash

SCRIPT_DIR=$( dirname -- "$0"; )
URL=$1

echo 'Deploying contracts to network'$URL

solana program deploy --program-id $SCRIPT_DIR/programs/openbook_v2-keypair.json $SCRIPT_DIR/programs/openbook_v2.so -u $URL

solana program deploy --program-id $SCRIPT_DIR/programs/pyth_mock.json $SCRIPT_DIR/programs/pyth_mock.so -u $URL

solana program deploy --program-id $SCRIPT_DIR/programs/spl_noop.json $SCRIPT_DIR/programs/spl_noop.so -u $URL