from invariantive.common.consts import Chain
from invariantive.model.run import RunConfig

from agent import build_agent

if __name__ == "__main__":
    findings = build_agent("optimism", Chain.optimism).run(run_config=RunConfig(
        chain=Chain.optimism,
        hashes=["0x555a3f8dc4b58457dacd979d0d48d899aa6d9030cccccc04dfb54be4fc0396ab"],
    ))
    print(f"num findings: {len(findings['findings'])}")
    for f in findings["findings"]:
        print(f["description"])
        print("extracted_variables:", f["extracted_variables"])
