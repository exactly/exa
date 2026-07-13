from invariantive.common.consts import Chain
from invariantive.model.run import RunConfig

from agent import build_agent

if __name__ == "__main__":
    # BlockTrigger replays need blocks (not hashes); 0 means latest block
    run_config = RunConfig(chain=Chain.base, blocks=[0])

    # real threshold: expect 0 findings while supply sits below 80% of the cap
    findings = build_agent().run(run_config=run_config)
    print(f"threshold 80%  num findings: {len(findings['findings'])}")
    for f in findings["findings"]:
        print(f["description"])
        print("extracted_variables:", f["extracted_variables"])

    # lowered threshold: forces the alert path, exercising every variable end to end
    findings = build_agent(threshold=0.01).run(run_config=run_config)
    print(f"threshold  1%  num findings: {len(findings['findings'])}")
    for f in findings["findings"]:
        print(f["description"])
        print("extracted_variables:", f["extracted_variables"])
