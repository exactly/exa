use anyhow::{Error, Ok, Result};
use glob::glob;
use indoc::indoc;
use serde::Deserialize;
use serde_json::from_str;
use std::{
  env::var,
  fs::{canonicalize, create_dir_all, read_to_string, File},
  io::Write,
  process::Command,
};
use substreams_ethereum::Abigen;

#[derive(Deserialize, Debug)]
struct Deployment {
  address: String,
}

fn main() -> Result<(), Error> {
  println!("cargo::rerun-if-changed=proto");
  println!("cargo::rerun-if-changed=substreams.yaml");
  println!("cargo::rerun-if-changed=node_modules/@exactly/protocol/deployments");
  println!("cargo::rerun-if-changed=../contracts/script/ExaAccountFactory.s.sol");
  println!("cargo::rerun-if-changed=../contracts/test/mocks/MockSwapper.sol");
  println!("cargo::rerun-if-changed=../contracts/node_modules/@exactly/contracts/contracts/Auditor.sol");
  println!("cargo::rerun-if-changed=../contracts/node_modules/@exactly/contracts/contracts/Market.sol");

  create_dir_all("abi")?;
  let contracts =
    [("auditor", "Auditor"), ("factory", "ExaAccountFactory"), ("lifi", "MockSwapper"), ("market", "Market")];

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
      .write_to_file(format!("src/contracts/{mod_name}.rs"))
      .unwrap();
  });

  File::create("src/contracts/mod.rs")?.write_all(
    format!(
      indoc! {"// @generated
        {}
        use substreams::hex;

        pub fn is_market(address: &[u8]) -> bool {{
          matches!(
            address,
            {}
          )
        }}

        pub fn is_auditor(address: &[u8]) -> bool {{
          matches!(
            address,
            {}
          )
        }}
      "},
      contracts
        .iter()
        .map(|(mod_name, _)| *mod_name)
        .map(|mod_name| format!("#[allow(clippy::style, clippy::complexity)]\npub mod {mod_name};\n"))
        .collect::<String>(),
      glob(&format!(
        "node_modules/@exactly/protocol/deployments/{}/Market*.json",
        match option_env!("CHAIN_ID") {
          Some("10") => "optimism",
          _ => "op-sepolia",
        }
      ))?
      .filter_map(Result::ok)
      .filter(|path| {
        !path.to_str().is_some_and(|s| s.contains("_Implementation") || s.contains("_Proxy") || s.contains("Router"))
      })
      .map(|path| -> Result<String, Error> {
        println!("cargo::rerun-if-changed={}", path.display());
        Ok(format!("hex!(\"{}\")", &from_str::<Deployment>(&read_to_string(&path)?)?.address[2..]))
      })
      .collect::<Result<Vec<_>, _>>()?
      .join("\n      | "),
      glob(&format!(
        "node_modules/@exactly/protocol/deployments/{}/Auditor.json",
        match option_env!("CHAIN_ID") {
          Some("10") => "optimism",
          _ => "op-sepolia",
        }
      ))?
      .filter_map(Result::ok)
      .map(|path| -> Result<String, Error> {
        println!("cargo::rerun-if-changed={}", path.display());
        Ok(format!("hex!(\"{}\")", &from_str::<Deployment>(&read_to_string(&path)?)?.address[2..]))
      })
      .collect::<Result<Vec<_>, _>>()?
      .join("\n      | ")
    )
    .as_bytes(),
  )?;

  assert!(Command::new("substreams")
    .arg("protogen")
    .arg("--exclude-paths=sf/substreams,google")
    .env("PATH", format!("{}:{}", canonicalize("node_modules/.bin")?.display(), var("PATH").unwrap_or_default()))
    .status()
    .expect("protogen failed")
    .success());

  assert!(Command::new("bash")
    .arg("-c")
    .arg("rustfmt src/{contracts,proto}/**")
    .status()
    .expect("formatting failed")
    .success());

  Ok(())
}
