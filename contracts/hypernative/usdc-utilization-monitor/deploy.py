from agent import build_agent

if __name__ == "__main__":
    aid = build_agent().deploy(
        agent_name="exaUSDC Utilization - BASE",
        severity="Medium",
    )
    print("deployed id=" + str(aid) if aid != -1 else "FAILED")
