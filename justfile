deploy RPC:
    ./configure/deploy-programs.sh {{ RPC }}

deploy-local:
    ./configure/deploy-programs.sh http://127.0.0.1:8899

configure USERS:
    yarn ts-node configure/configure_openbook_v2.ts -p {{ USERS }}

configure-10:
    yarn ts-node configure/configure_openbook_v2.ts -p 10

run:
    cargo run -- -c configure/config.json -a $HOME/.config/solana/id.json -t logs.csv -b blog.csv