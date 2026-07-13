from invariantive.model.agent import Agent
from invariantive.model.trigger import EventTrigger
from invariantive.model.variable import ContextVariable, PythonProcessingVariable
from invariantive.model.alert import AlertConfig
from invariantive.common.consts import Chain

EXA_ADDRESS = "0x1e925De1c68ef83bD98eE3E130eF14a50309C01B"

CHAINS = [
    ("optimism", Chain.optimism),
    ("base",     Chain.base),
]


def build_agent(name: str, chain: Chain) -> Agent:
    agent = Agent(trigger=EventTrigger(
        chain=chain,
        contract_address=EXA_ADDRESS,
        event_sig="CrosschainMint(address indexed to, uint256 amount, address indexed sender)",
        output_index="emitting_contract",
        operator="compare_exact",
        operands=[EXA_ADDRESS],
        output_data_type=["address", "uint256", "address"],
    ))

    agent.add_variable(ContextVariable(output_index="emitted_arg_0", var_name="recipient"))
    agent.add_variable(ContextVariable(output_index="emitted_arg_1", var_name="amount"))
    agent.add_variable(ContextVariable(output_index="emitted_arg_2", var_name="caller"))
    agent.add_variable(ContextVariable(output_index="tx_hash",       var_name="tx"))

    agent.add_variable(PythonProcessingVariable(source_code=check_supply,     var_name="check_supply"))
    agent.add_variable(PythonProcessingVariable(source_code=exceeded,          var_name="exceeded"))
    agent.add_variable(PythonProcessingVariable(source_code=detail,           var_name="detail"))
    agent.add_variable(PythonProcessingVariable(source_code=amount_fmt,       var_name="amount_fmt"))
    agent.add_variable(PythonProcessingVariable(source_code=supply_optimism,  var_name="supply_optimism"))
    agent.add_variable(PythonProcessingVariable(source_code=supply_base,      var_name="supply_base"))
    agent.add_variable(PythonProcessingVariable(source_code=combined_supply,  var_name="combined_supply"))

    agent.set_alert(AlertConfig(
        var_name="exceeded",
        operator="compare_exact",
        operands=[True],
        description=(
            f"exa combined supply exceeded the 10m cap after crosschainmint on {name}\n\n"
            "minted:    {{amount_fmt}} EXA\n"
            "caller:    {{caller}}\n"
            "recipient: {{recipient}}\n"
            "optimism:  {{supply_optimism}} EXA\n"
            "base:      {{supply_base}} EXA\n"
            "combined:  {{combined_supply}} EXA\n"
            "detail:    {{detail}}\n"
            "tx:        {{tx}}"
        ),
        is_one_shot=True,
    ))

    return agent


def check_supply(extracted_variables):
    from web3 import Web3
    abi = '[{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]'
    exa = Web3.to_checksum_address("0x1e925De1c68ef83bD98eE3E130eF14a50309C01B")
    try:
        op = get_node("optimism").w3
        base = get_node("base").w3
        op_block = op.eth.get_block("latest")
        base_block = base.eth.get_block("latest")
        supply_optimism = op.eth.contract(address=exa, abi=abi).functions.totalSupply().call(block_identifier=op_block["number"])
        supply_base = base.eth.contract(address=exa, abi=abi).functions.totalSupply().call(block_identifier=base_block["number"])
    except Exception as e:
        return {"exceeded": False, "detail": f"read failed: {e}", "supply_optimism": "n/a", "supply_base": "n/a", "combined_supply": "n/a"}
    delta = abs(int(op_block["timestamp"]) - int(base_block["timestamp"]))
    combined_supply = int(supply_optimism) + int(supply_base)
    return {
        "exceeded": delta <= 20 and combined_supply > 10_000_000 * 10**18,
        "detail": f"head delta {delta}s (optimism block {op_block['number']} {op_block['timestamp']}, base block {base_block['number']} {base_block['timestamp']})",
        "supply_optimism": str(supply_optimism),
        "supply_base": str(supply_base),
        "combined_supply": str(combined_supply),
    }


def exceeded(extracted_variables):
    return bool((extracted_variables.get("check_supply") or {}).get("exceeded", False))


def detail(extracted_variables):
    return str((extracted_variables.get("check_supply") or {}).get("detail", "check_supply variable missing"))


def amount_fmt(extracted_variables):
    return f"{int(extracted_variables['amount']) / 1e18:,.2f}"


def supply_optimism(extracted_variables):
    value = (extracted_variables.get("check_supply") or {}).get("supply_optimism", "n/a")
    return f"{int(value) / 1e18:,.2f}" if value != "n/a" else "n/a"


def supply_base(extracted_variables):
    value = (extracted_variables.get("check_supply") or {}).get("supply_base", "n/a")
    return f"{int(value) / 1e18:,.2f}" if value != "n/a" else "n/a"


def combined_supply(extracted_variables):
    value = (extracted_variables.get("check_supply") or {}).get("combined_supply", "n/a")
    return f"{int(value) / 1e18:,.2f}" if value != "n/a" else "n/a"
