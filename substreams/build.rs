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
  println!("cargo::rerun-if-changed=../contracts/script/ExaPlugin.s.sol");
  println!("cargo::rerun-if-changed=../contracts/test/mocks/MockSwapper.sol");
  println!("cargo::rerun-if-changed=../contracts/test/mocks/MockPriceFeed.sol");
  println!("cargo::rerun-if-changed=../contracts/node_modules/@exactly/contracts/contracts/Auditor.sol");
  println!("cargo::rerun-if-changed=../contracts/node_modules/@exactly/contracts/contracts/Market.sol");

  create_dir_all("abi")?;
  let contracts = [
    ("auditor", "Auditor"),
    ("factory", "ExaAccountFactory"),
    ("plugin", "ExaPlugin"),
    ("lifi", "MockSwapper"),
    ("market", "Market"),
    ("chainlink", "MockPriceFeed"),
  ];

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

        pub fn is_chainlink(address: &[u8]) -> bool {{
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

        pub fn is_plugin(address: &[u8]) -> bool {{
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
      .join("\n      | "),
      // FIXME: get price feed aggregators
      glob(&format!(
        "node_modules/@exactly/protocol/deployments/{}/PriceFeed*.json",
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
      .join("\n      | "),
      match option_env!("CHAIN_ID") {
        Some("10") => vec![
          "8D493AF799162Ac3f273e8918B2842447f702163",
          "3427a595eD6E05Cc2D8115e28BAd151cB879616e",
          "cbeaAF42Cc39c17e84cBeFe85160995B515A9668",
          "961EbA47650e2198A959Ef5f337E542df5E4F61b",
        ],
        _ => vec![
          "9cCab24277a9E6be126Df3A563c90B4eBf6D5e26",
          "98b3E5C7a039A329a4446A3FACB860C506B28901",
          "8cA9Bb05f6a9CDf3412d64C25907358686277E5c",
          "086E2e36a98d266c81E453f0129ec01A34e64cF9",
          "8D493AF799162Ac3f273e8918B2842447f702163",
          "b312816855ca94d8fb4Cbea9E63BD6b12353AfBe",
          "cE820eea73585E62347db9E1DA3aa804Ba7c3863",
          "5B710958D215F7951ec67e1bb13077F5fBB3a3F1",
          "Fe619D955F5bfbf810b93315A340eE32d288BB63",
          "861337355FE34cF70bcC586F276a0151E7F5Beba",
          "3F62562c6f2aD9A623cb5fceD48053c691F95228",
          "FC86cc5aE0FbE173fe385114F5F0a9C4Afe60B6F",
          "98d3E8B291d9E89C25D8371b7e8fFa8BC32E0aEC",
        ],
      }
      .iter()
      .map(|a| format!("hex!(\"{a}\")"))
      .collect::<Vec<_>>()
      .join("\n      | "),
      match option_env!("CHAIN_ID") {
        Some("10") => vec![""], // FIXME: get op-mainnet plugin addresses
        _ => vec!["5B1e61a7802Dc02Bf55435077aC5FF057d06e4AE"],
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

  assert!(Command::new("bash")
    .arg("-c")
    .arg("rustfmt src/{contracts,proto}/**")
    .status()
    .expect("formatting failed")
    .success());

  Ok(())
}
