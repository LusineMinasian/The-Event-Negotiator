================================================================================
 THE EVENT NEGOTIATOR — AGENT GENERATION PACK
 Prompts + tool specs to build every ElevenLabs agent this system needs.
================================================================================

WHAT THIS FOLDER IS
-------------------
These are the source prompts you paste into the ElevenLabs Agents Platform to
create each agent, plus the exact tool (webhook / MCP) contracts each agent needs
so it can read verified leverage and push live deal changes back to THIS backend.

Nothing here runs on its own. Each file is one artifact:
  - an agent = one system prompt + persona + behavior + which tools it holds
  - a tool   = one webhook/MCP/system-tool config + the server endpoint it hits

Everything is grounded in the real backend already in this repo:
  - Leverage / levers ......... backend/app/configs/levers.yaml + engines/leverage.py
  - Segment behavior .......... backend/app/configs/segments/*.yaml
  - Counterparty styles ....... backend/app/services/counterparty.py
  - Live event bus (War Room).. backend/app/services/event_bus.py
  - Live call dispatch ........ backend/app/services/caller.py (_dispatch_live)
  - EL connector .............. backend/app/services/elevenlabs_connector.py
  - Webhook ingestion ......... backend/app/routers/integrations.py

FILE MAP
--------
  README.txt                         <- you are here
  00_platform_setup.txt              <- Twilio link, dynamic variables, webhook secret,
                                        realtime model (READ THIS FIRST)

  agents/
    01_caller_negotiator.txt         <- ★ THE MAIN AGENT: calls vendors, negotiates,
                                        streams deal changes back in realtime
    02_intake_estimator.txt          <- voice interview that builds the job spec

    counterparties/                  <- the practice / agent-to-agent market
      cp_00_base.txt                 <- shared counterparty mechanics
      cp_stonewaller.txt             <- "we don't quote over the phone"
      cp_hard.txt                    <- firm, small real concession (full-service caterer)
      cp_upseller.txt                <- pushes the premium package
      cp_lowballer.txt               <- cheap opener, hidden fees on top (red-flag bait)
      cp_flexible.txt                <- moves easily; may reclassify mid-call

  tools/
    tool_get_verified_leverage.txt   <- READ: what numbers the agent may cite
    tool_log_quote.txt               <- WRITE: structured quote + itemized fees
    tool_record_price_move.txt       <- WRITE: a price/term change (the realtime signal)
    tool_check_red_flags.txt         <- READ: 30%-below-market etc. rules
    tool_reclassify_segment.txt      <- WRITE: vendor is a different segment than we thought
    tool_request_human.txt           <- WRITE: "Pull Me In" human handoff
    system_tools.txt                 <- end_call, voicemail_detection, transfer_to_number, skip_turn
    mcp_server.txt                   <- optional: expose all write-tools via one MCP server
    post_call_webhook.txt            <- server ingestion of the finished transcript

HOW TO USE
----------
1. Read 00_platform_setup.txt. Set up the Twilio link + dynamic variables + the
   webhook shared secret. This is the plumbing every agent depends on.
2. Create the tool endpoints on your server (contracts in tools/*.txt). They just
   validate + publish to the existing event bus keyed by campaign_id.
3. In ElevenLabs, register the webhook tools (tools/*.txt) OR one MCP server
   (mcp_server.txt) so the agent can call them mid-call.
4. Create the Caller agent from agents/01_caller_negotiator.txt and attach the tools.
5. Create the Intake agent from agents/02_intake_estimator.txt.
6. For the demo market, create the counterparty agents from counterparties/*.txt
   (or role-play them yourself, or point at real businesses — all valid).

THE ONE THING THAT MATTERS MOST
-------------------------------
The challenge is won in CALL DESIGN, not model architecture. The Caller must make a
real price move DURING a call because of leverage it actually holds — never because
a script said so. That honesty line runs through every file: the agent may only cite
numbers returned by get_verified_leverage, and it may never invent inventory, fees,
or a fake competing bid. See agents/01_caller_negotiator.txt § GUARDRAILS.
