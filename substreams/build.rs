use anyhow::{Error, Ok, Result};
use glob::glob;
use indoc::indoc;
use std::{
  env::var,
  fs::{canonicalize, create_dir_all, File},
  io::Write,
  process::Command,
};
use substreams_ethereum::Abigen;

fn main() -> Result<(), Error> {
  println!("cargo::rerun-if-changed=proto");
  println!("cargo::rerun-if-changed=buf.gen.yaml");
  println!("cargo::rerun-if-changed=substreams.yaml");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/script/ExaAccountFactory.s.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/script/ExaPlugin.s.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/script/ProposalManager.s.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/test/mocks/MockPriceFeed.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/test/mocks/MockSwapper.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/plugin/node_modules/modular-account/src/account/UpgradeableModularAccount.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/protocol/contracts/Auditor.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/protocol/contracts/Market.sol");
  println!("cargo::rerun-if-changed=node_modules/@exactly/protocol/deployments");
  println!("cargo::rerun-if-env-changed=CHAIN_ID");

  create_dir_all("abi")?;
  let contracts = [
    ("account", "UpgradeableModularAccount"),
    ("auditor", "Auditor"),
    ("factory", "ExaAccountFactory"),
    ("market", "Market"),
    ("plugin", "ExaPlugin"),
    ("proposal_manager", "ProposalManager"),
  ];

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
      indoc! {"// @generated\n{}\n"},
      contracts
        .iter()
        .map(|(mod_name, _)| *mod_name)
        .map(|mod_name| format!("#[expect(clippy::style, clippy::complexity)]\npub mod {mod_name};\n"))
        .collect::<String>(),
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
