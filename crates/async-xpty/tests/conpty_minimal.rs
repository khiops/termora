#[cfg(windows)]
#[tokio::test]
async fn conpty_cmd_survives_3s() {
    use async_xpty::{CommandBuilder, PtyProcess};
    use tokio::io::AsyncReadExt;
    use tokio::time::{timeout, Duration};
    let cmd = CommandBuilder::new("cmd.exe").arg("/k").size(80, 24);
    let mut proc = cmd.spawn().await.expect("spawn failed");
    let mut reader = proc.reader();
    let mut all_output = Vec::new();
    let mut buf = vec![0u8; 4096];
    let result = timeout(Duration::from_secs(3), async {
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => return "EOF",
                Err(e) => return Box::leak(format!("Error: {}", e).into_boxed_str()),
                Ok(n) => all_output.extend_from_slice(&buf[..n]),
            }
        }
    })
    .await;
    let s: String = all_output
        .iter()
        .map(|&b| {
            if b >= 0x20 && b < 0x7f {
                b as char
            } else {
                '.'
            }
        })
        .collect();
    println!("Output ({} bytes): {}", all_output.len(), s);
    match result {
        Err(_) => println!("PASS: cmd.exe survived 3 seconds"),
        Ok(reason) => {
            if let Ok(status) = proc.wait().await {
                println!(
                    "Exit code: {} (0x{:08x})",
                    status.code().unwrap_or(-1),
                    status.code().unwrap_or(-1) as u32
                );
            }
            panic!("FAIL: cmd.exe did not survive - {}", reason);
        }
    }
}
#[cfg(not(windows))]
#[test]
fn conpty_cmd_survives_3s() {
    println!("Skipped");
}
