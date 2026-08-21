use anyhow::{bail, Context, Result};
use npcink_device_agent::{collector, upload};
use std::env;
use std::time::Instant;

fn main() -> Result<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let command = args.first().map(String::as_str).unwrap_or("inspect");

    match command {
        "inspect" => inspect(&args[1..]),
        "upload-inspect" => upload_inspect(&args[1..]),
        "runtime" => runtime(&args[1..]),
        "device-id" => device_id(),
        "submit" => submit(&args[1..]),
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        other => bail!("unknown command: {other}"),
    }
}

fn runtime(args: &[String]) -> Result<()> {
    let pretty = args.iter().any(|arg| arg == "--pretty");
    let data = collector::collect_runtime_status()?;
    if pretty {
        println!("{}", serde_json::to_string_pretty(&data)?);
    } else {
        println!("{}", serde_json::to_string(&data)?);
    }
    Ok(())
}

fn inspect(args: &[String]) -> Result<()> {
    let pretty = args.iter().any(|arg| arg == "--pretty");
    let data = collector::collect_static_data()?;
    if pretty {
        println!("{}", serde_json::to_string_pretty(&data)?);
    } else {
        println!("{}", serde_json::to_string(&data)?);
    }
    Ok(())
}

fn upload_inspect(args: &[String]) -> Result<()> {
    let pretty = args.iter().any(|arg| arg == "--pretty");
    let started_at = Instant::now();
    let data = collector::collect_upload_data()?;
    let elapsed_ms = started_at.elapsed().as_millis();
    let payload_bytes = serde_json::to_vec(&data)?.len();
    eprintln!("upload-light collection: elapsed_ms={elapsed_ms} payload_bytes={payload_bytes}");
    if pretty {
        println!("{}", serde_json::to_string_pretty(&data)?);
    } else {
        println!("{}", serde_json::to_string(&data)?);
    }
    Ok(())
}

fn device_id() -> Result<()> {
    let data = collector::collect_static_data()?;
    let id = collector::hardware_identity_v2(&data)
        .map(|(_, value)| value)
        .context("missing device identity")?;
    println!("{id}");
    Ok(())
}

fn submit(args: &[String]) -> Result<()> {
    let site = required_flag(args, "--site")?;
    let note = optional_flag(args, "--note")
        .or_else(|| optional_flag(args, "--name"))
        .unwrap_or_default();
    let token = required_flag(args, "--token")?;
    let data = collector::collect_static_data()?;
    let response = upload::submit_v3(&site, &note, &token, &data)?;
    println!("{}", serde_json::to_string_pretty(&response)?);
    Ok(())
}

fn required_flag(args: &[String], name: &str) -> Result<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("missing required flag {name}"))
}

fn optional_flag(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].trim().to_string())
        .filter(|value| !value.is_empty())
}

fn print_help() {
    println!(
        "Npcink Device Agent\n\n\
Commands:\n\
  inspect [--pretty]    Print compatible hardware JSON\n\
  upload-inspect [--pretty]  Print the lightweight upload JSON and timing\n\
  runtime [--pretty]    Print runtime monitor JSON\n\
  device-id             Print the canonical or fallback device identity\n\
  submit --site URL --token TOKEN [--note NOTE]            Submit to device observation endpoint\n"
    );
}
