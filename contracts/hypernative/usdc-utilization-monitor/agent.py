from invariantive.model.agent import Agent
from invariantive.model.trigger import BlockTrigger
from invariantive.model.variable import ContextVariable, PythonProcessingVariable
from invariantive.model.alert import AlertConfig
from invariantive.common.consts import Chain

THRESHOLD = 0.90
PERIOD_SECONDS = 60


def build_agent(threshold: float = THRESHOLD) -> Agent:
    agent = Agent(trigger=BlockTrigger(
        period=PERIOD_SECONDS,
        period_unit="seconds",
        chain=Chain.base,
    ))

    agent.add_variable(ContextVariable(output_index="block_number", var_name="block_number"))

    agent.add_variable(PythonProcessingVariable(source_code=read_market,        var_name="market_state"))
    agent.add_variable(PythonProcessingVariable(source_code=global_utilization, var_name="global_utilization"))
    agent.add_variable(PythonProcessingVariable(source_code=utilization_pct,    var_name="utilization_pct"))
    agent.add_variable(PythonProcessingVariable(source_code=floating_debt,      var_name="floating_debt"))
    agent.add_variable(PythonProcessingVariable(source_code=backup_borrowed,    var_name="backup_borrowed"))
    agent.add_variable(PythonProcessingVariable(source_code=floating_assets_avg, var_name="floating_assets_avg"))

    agent.set_alert(AlertConfig(
        var_name="global_utilization",
        operator="gte",
        operands=[threshold],
        description=(
            f"exaUSDC global utilization on base crossed above {threshold:.0%}\n\n"
            "utilization:         {{utilization_pct}}%\n"
            "floating debt:       {{floating_debt}} usdc\n"
            "backup borrowed:     {{backup_borrowed}} usdc\n"
            "floating assets avg: {{floating_assets_avg}} usdc\n"
            "block:               {{block_number}}"
        ),
    ))

    return agent


def read_market(extracted_variables):
    import json
    from web3 import Web3

    # exaUSDC Market proxy on base (deployments/base/MarketUSDC.json)
    market_address = Web3.to_checksum_address("0x61EDAcB54aA8a689013682529df8914C87692E4b")
    abi = json.loads(
        '[{"inputs":[],"name":"totalFloatingBorrowAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},'
        '{"inputs":[],"name":"floatingBackupBorrowed","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},'
        '{"inputs":[],"name":"previewFloatingAssetsAverage","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]'
    )
    # pin every read to the trigger block so the ratio is computed from one snapshot
    block = int(extracted_variables["block_number"])
    market = get_node("base").w3.eth.contract(address=market_address, abi=abi)

    floating_debt = market.functions.totalFloatingBorrowAssets().call(block_identifier=block)
    backup_borrowed = market.functions.floatingBackupBorrowed().call(block_identifier=block)
    floating_assets_avg = market.functions.previewFloatingAssetsAverage().call(block_identifier=block)
    # Market.sol globalUtilization as fed to the IRM
    utilization = (floating_debt + backup_borrowed) / floating_assets_avg if floating_assets_avg > 0 else 0.0
    return {
        "utilization": utilization,
        "floating_debt": floating_debt,
        "backup_borrowed": backup_borrowed,
        "floating_assets_avg": floating_assets_avg,
    }


def global_utilization(extracted_variables):
    return float(extracted_variables["market_state"]["utilization"])


def utilization_pct(extracted_variables):
    return f"{extracted_variables['market_state']['utilization'] * 100:.2f}"


def floating_debt(extracted_variables):
    return f"{extracted_variables['market_state']['floating_debt'] / 1e6:,.2f}"


def backup_borrowed(extracted_variables):
    return f"{extracted_variables['market_state']['backup_borrowed'] / 1e6:,.2f}"


def floating_assets_avg(extracted_variables):
    return f"{extracted_variables['market_state']['floating_assets_avg'] / 1e6:,.2f}"
