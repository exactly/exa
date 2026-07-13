from agent import CHAINS, build_agent

if __name__ == "__main__":
    for name, chain in CHAINS:
        aid = build_agent(name, chain).deploy(
            agent_name=f"EXA crosschain Supply - {name}",
            severity="High",
        )
        print(f"{name:12s}  {'deployed id=' + str(aid) if aid != -1 else 'FAILED'}")
