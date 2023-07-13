use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use log::{debug, info};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::hash::Hash;
use tokio::{sync::RwLock, task::JoinHandle, time::Instant};

pub async fn get_new_latest_blockhash(client: Arc<RpcClient>, blockhash: &Hash) -> Option<Hash> {
    let start = Instant::now();
    while start.elapsed().as_secs() < 5 {
        if let Ok(new_blockhash) = client.get_latest_blockhash().await {
            if new_blockhash != *blockhash {
                return Some(new_blockhash);
            }
        }
        debug!("Got same blockhash ({:?}), will retry...", blockhash);

        // Retry ~twice during a slot
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    None
}

pub async fn poll_blockhash_and_slot(
    blockhash: Arc<RwLock<Hash>>,
    slot: &AtomicU64,
    client: Arc<RpcClient>,
) {
    let mut blockhash_last_updated = Instant::now();
    //let mut last_error_log = Instant::now();
    loop {
        let client = client.clone();
        let old_blockhash = *blockhash.read().await;

        match client.get_slot().await {
            Ok(new_slot) => slot.store(new_slot, Ordering::Release),
            Err(e) => {
                info!("Failed to download slot: {}, skip", e);
                continue;
            }
        }

        if let Some(new_blockhash) = get_new_latest_blockhash(client, &old_blockhash).await {
            {
                *blockhash.write().await = new_blockhash;
            }
            blockhash_last_updated = Instant::now();
        } else {
            log::error!("Error updating recent blockhash");
            if blockhash_last_updated.elapsed().as_secs() > 120 {
                log::error!("Failed to update blockhash quitting task");
                break;
            }
        }

        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

pub fn start_blockhash_polling_service(
    blockhash: Arc<RwLock<Hash>>,
    current_slot: Arc<AtomicU64>,
    client: Arc<RpcClient>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        poll_blockhash_and_slot(blockhash.clone(), current_slot.as_ref(), client).await;
    })
}
