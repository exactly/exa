use anyhow::{Error, Ok, Result};
use std::process::Command;
use substreams_ethereum::Abigen;

fn main() -> Result<(), Error> {
  println!("cargo::rerun-if-changed=abi");
  println!("cargo::rerun-if-changed=proto");
  println!("cargo::rerun-if-changed=substreams.yaml");

  Abigen::new("EntryPoint", "abi/entrypoint.json")?.generate()?.write_to_file("src/abi/entrypoint.rs")?;
  Abigen::new("ERC20", "abi/erc20.json")?.generate()?.write_to_file("src/abi/erc20.rs")?;
  Abigen::new("Market", "abi/market.json")?.generate()?.write_to_file("src/abi/market.rs")?;
  // Abigen::new("Market", "node_modules/@exactly/protocol/deployments/optimism/MarketUSDC_Implementation.json")?
  //   .generate()?
  //   .write_to_file("src/abi/market.rs")?;

  assert!(Command::new("substreams").arg("protogen").status().expect("protogen failed").success());

  Ok(())
}
