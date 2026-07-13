from invariantive.model.agent import Agent
from invariantive.model.trigger import BlockTrigger
from invariantive.model.variable import ContextVariable, PythonProcessingVariable
from invariantive.model.alert import AlertConfig
from invariantive.common.consts import Chain

THRESHOLD = 0.80
PERIOD_SECONDS = 60

def build_agent(threshold: float = THRESHOLD) -> Agent:
    agent = Agent(trigger=BlockTrigger(
        period=PERIOD_SECONDS,
        period_unit="seconds",
        chain=Chain.base,
    ))

    agent.add_variable(ContextVariable(output_index="block_number", var_name="block_number"))

    agent.add_variable(PythonProcessingVariable(source_code=read_market,   var_name="market_state"))
    agent.add_variable(PythonProcessingVariable(source_code=cap_ratio,     var_name="cap_ratio"))
    agent.add_variable(PythonProcessingVariable(source_code=cap_ratio_pct, var_name="cap_ratio_pct"))
    agent.add_variable(PythonProcessingVariable(source_code=total_supply,  var_name="total_supply"))
    agent.add_variable(PythonProcessingVariable(source_code=max_supply,    var_name="max_supply"))

    agent.set_alert(AlertConfig(
        var_name="cap_ratio",
        operator="gte",
        operands=[threshold],
        description=(
            f"exacbXRP supply on base crossed above {threshold:.0%} of its cap\n\n"
            "cap used:     {{cap_ratio_pct}}%\n"
            "total supply: {{total_supply}} exacbXRP\n"
            "max supply:   {{max_supply}} exacbXRP\n"
            "block:        {{block_number}}"
        ),
    ))

    return agent


def read_market(extracted_variables):
    import json
    from web3 import Web3

    # exacbXRP Market proxy on base (deployments/base/MarketcbXRP.json)
    market_address = Web3.to_checksum_address("0x1Dcf89Dfa88363ef33d49dD591b1eE5e84DD0F75")
    abi = json.loads(
        '[{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},'
        '{"inputs":[],"name":"maxSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]'
    )
    # pin every read to the trigger block so the ratio is computed from one snapshot
    block = int(extracted_variables["block_number"])
    market = get_node("base").w3.eth.contract(address=market_address, abi=abi)

    total_supply = market.functions.totalSupply().call(block_identifier=block)
    max_supply = market.functions.maxSupply().call(block_identifier=block)

    ratio = total_supply / max_supply if max_supply > 0 else 0.0
    return {
        "ratio": ratio,
        "total_supply": total_supply,
        "max_supply": max_supply,
    }


def cap_ratio(extracted_variables):
    return float(extracted_variables["market_state"]["ratio"])


def cap_ratio_pct(extracted_variables):
    return f"{extracted_variables['market_state']['ratio'] * 100:.2f}"


def total_supply(extracted_variables):
    return f"{extracted_variables['market_state']['total_supply'] / 1e6:,.2f}"


def max_supply(extracted_variables):
    return f"{extracted_variables['market_state']['max_supply'] / 1e6:,.2f}"
