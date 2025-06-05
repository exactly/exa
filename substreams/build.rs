use anyhow::{Error, Ok, Result};
use std::{
  env::var,
  fs::{canonicalize, create_dir_all},
  process::Command,
};
use substreams_ethereum::Abigen;

fn main() -> Result<(), Error> {
  println!("cargo::rerun-if-changed=proto");
  println!("cargo::rerun-if-changed=substreams.yaml");
  println!("cargo::rerun-if-changed=../contracts/script/ExaAccountFactory.s.sol");
  println!("cargo::rerun-if-changed=../contracts/test/mocks/MockSwapper.sol");

  create_dir_all("abi")?;
  let contracts = [("factory", "ExaAccountFactory"), ("lifi", "MockSwapper")];

  assert!(Command::new("bash")
    .arg("-c")
    .arg("forge build")
    .current_dir("../contracts")
    .status()
    .expect("forge build failed")
    .success());

  contracts.iter().for_each(|(mod_name, contract_name)| {
    assert!(Command::new("bash")
      .arg("-c")
      .arg(format!("jq .abi ../contracts/out/{contract_name}.sol/{contract_name}.json > abi/{mod_name}.json"))
      .status()
      .expect("abi extraction failed")
      .success());

    Abigen::new(*contract_name, &format!("abi/{mod_name}.json"))
      .unwrap()
      .generate()
      .unwrap()
      .write_to_file(format!("src/abi/{mod_name}.rs"))
      .unwrap();
  });

  assert!(Command::new("substreams")
    .arg("protogen")
    .arg("--exclude-paths=sf/substreams,google")
    .env("PATH", format!("{}:{}", canonicalize("node_modules/.bin")?.display(), var("PATH").unwrap_or_default()))
    .status()
    .expect("protogen failed")
    .success());

  assert!(Command::new("bash")
    .arg("-c")
    .arg(format!(
      "echo -e '{}' > src/abi/mod.rs",
      contracts
        .iter()
        .map(|(mod_name, _)| format!("#[allow(clippy::all)]\\npub mod {mod_name};"))
        .collect::<Vec<_>>()
        .join("\\n")
    ))
    .status()
    .expect("mod.rs generation failed")
    .success());

  Ok(())
}
