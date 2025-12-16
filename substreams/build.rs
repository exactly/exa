use anyhow::{Error, Ok, Result};
use glob::glob;
use indoc::indoc;
use regex::Regex;
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
  println!("cargo::rerun-if-changed=buf.gen.yaml");
  println!("cargo::rerun-if-changed=substreams.yaml");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/script/ExaAccountFactory.s.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/script/ExaPlugin.s.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/script/ProposalManager.s.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/test/mocks/MockPriceFeed.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/test/mocks/MockSwapper.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/protocol/contracts/Auditor.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/protocol/contracts/Market.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/protocol/deployments");
  println!("cargo::rerun-if-env-changed=CHAIN_ID");

  create_dir_all("abi")?;
  let contracts = [
    ("auditor", "Auditor"),
    ("chainlink", "MockPriceFeed"),
    ("factory", "ExaAccountFactory"),
    ("lifi", "MockSwapper"),
    ("market", "Market"),
    ("plugin", "ExaPlugin"),
    ("proposal_manager", "ProposalManager"),
  ];

  let factory_address = Regex::new(r"(?i)== return ==\n0: address 0x([\da-f]{40})")?
    .captures(&String::from_utf8(
      Command::new("forge")
        .current_dir("../contracts")
        .args([
          "script",
          "-s",
          "getAddress()",
          "script/ExaAccountFactory.s.sol",
          "--chain",
          option_env!("CHAIN_ID").unwrap_or("31337"),
        ])
        .output()
        .expect("factory address calculation failed")
        .stdout,
    )?)
    .map(|capture| capture[1].to_string());

  contracts.iter().try_for_each(|(mod_name, contract_name)| -> Result<()> {
    assert!(Command::new("bash")
      .arg("-c")
      .arg(format!("jq .abi ../contracts/out/{contract_name}.sol/{contract_name}.json > abi/{mod_name}.json"))
      .status()
      .expect("abi extraction failed")
      .success());
    Abigen::new(*contract_name, &format!("abi/{mod_name}.json"))?
      .generate()?
      .write_to_file(format!("src/contracts/{mod_name}.rs"))?;
    Ok(())
  })?;

  File::create("src/contracts/mod.rs")?.write_all(
    format!(
      indoc! {"// @generated
        {}
        use substreams::hex;

        pub fn is_auditor(address: &[u8]) -> bool {{
          matches!(
            address,
            {}
          )
        }}

        pub fn is_factory(address: &[u8]) -> bool {{
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
      if option_env!("CHAIN_ID").is_none() {
        format!("hex!(\"{}\")", "e7f1725E7734CE288F8367e1Bb143E90bb3F0512")
      } else {
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
      },
      match option_env!("CHAIN_ID") {
        Some("10") => vec![
          "8D493AF799162Ac3f273e8918B2842447f702163",
          "3427a595eD6E05Cc2D8115e28BAd151cB879616e",
          "cbeaAF42Cc39c17e84cBeFe85160995B515A9668",
          "961EbA47650e2198A959Ef5f337E542df5E4F61b",
        ],
        _ => vec![factory_address.as_deref().unwrap()],
      }
      .iter()
      .map(|a| format!("hex!(\"{a}\")"))
      .collect::<Vec<_>>()
      .join("\n      | "),
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

  assert!(Command::new("rustfmt")
    .args(glob("src/contracts/**/*.rs")?.chain(glob("src/proto/**/*.rs")?).filter_map(Result::ok))
    .status()
    .expect("formatting failed")
    .success());

  Ok(())
}
