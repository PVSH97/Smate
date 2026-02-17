#!/usr/bin/env python3
"""
Meta WhatsApp Business API MCP Server

Full-featured MCP server for managing WhatsApp Business API:
- Template management (list, create, delete)
- Message sending (template + free-form text)
- Account analytics
- Phone number management

Project: SMate
"""

import os
import sys
import json
import asyncio
import traceback
from typing import Any
import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    Tool,
    TextContent,
    Resource,
    ResourceTemplate,
)

def log(msg: str):
    """Log to stderr (visible in MCP logs)"""
    print(f"[meta-whatsapp] {msg}", file=sys.stderr, flush=True)

# Configuration from environment
META_ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN", "")
WABA_ID = os.getenv("META_WABA_ID", "")
PHONE_NUMBER_ID = os.getenv("META_PHONE_NUMBER_ID", "")
API_VERSION = "v24.0"
BASE_URL = f"https://graph.facebook.com/{API_VERSION}"

server = Server("meta-whatsapp")


async def make_request(method: str, endpoint: str, data: dict = None) -> dict:
    """Make authenticated request to Meta Graph API"""
    url = f"{BASE_URL}/{endpoint}"
    headers = {
        "Authorization": f"Bearer {META_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient() as client:
        if method == "GET":
            response = await client.get(url, headers=headers, params=data)
        elif method == "POST":
            response = await client.post(url, headers=headers, json=data)
        elif method == "DELETE":
            response = await client.delete(url, headers=headers)
        else:
            raise ValueError(f"Unsupported method: {method}")

        return response.json()


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools"""
    return [
        Tool(
            name="list_templates",
            description="List all WhatsApp message templates with their status and category",
            inputSchema={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "description": "Filter by status: APPROVED, PENDING, REJECTED",
                        "enum": ["APPROVED", "PENDING", "REJECTED"]
                    },
                    "category": {
                        "type": "string",
                        "description": "Filter by category: UTILITY, MARKETING, AUTHENTICATION",
                        "enum": ["UTILITY", "MARKETING", "AUTHENTICATION"]
                    }
                }
            }
        ),
        Tool(
            name="get_template",
            description="Get details of a specific template by ID or name",
            inputSchema={
                "type": "object",
                "properties": {
                    "template_id": {
                        "type": "string",
                        "description": "Template ID"
                    },
                    "template_name": {
                        "type": "string",
                        "description": "Template name (alternative to ID)"
                    }
                }
            }
        ),
        Tool(
            name="create_template",
            description="Create a new WhatsApp message template",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Template name (lowercase, underscores only)"
                    },
                    "category": {
                        "type": "string",
                        "description": "Template category",
                        "enum": ["UTILITY", "MARKETING", "AUTHENTICATION"]
                    },
                    "language": {
                        "type": "string",
                        "description": "Language code (e.g., es_CL, es, en_US)",
                        "default": "es_CL"
                    },
                    "header_text": {
                        "type": "string",
                        "description": "Optional header text (max 60 chars)"
                    },
                    "body_text": {
                        "type": "string",
                        "description": "Body text with {{1}}, {{2}} placeholders"
                    },
                    "body_examples": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Example values for body placeholders"
                    },
                    "footer_text": {
                        "type": "string",
                        "description": "Optional footer text (max 60 chars)"
                    },
                    "buttons": {
                        "type": "array",
                        "description": "Optional buttons (QUICK_REPLY or URL)",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string", "enum": ["QUICK_REPLY", "URL"]},
                                "text": {"type": "string"},
                                "url": {"type": "string"}
                            }
                        }
                    }
                },
                "required": ["name", "category", "body_text", "body_examples"]
            }
        ),
        Tool(
            name="delete_template",
            description="Delete a WhatsApp message template by name",
            inputSchema={
                "type": "object",
                "properties": {
                    "template_name": {
                        "type": "string",
                        "description": "Template name to delete"
                    }
                },
                "required": ["template_name"]
            }
        ),
        Tool(
            name="get_account_info",
            description="Get WhatsApp Business Account information",
            inputSchema={"type": "object", "properties": {}}
        ),
        Tool(
            name="get_phone_numbers",
            description="Get phone numbers associated with the account",
            inputSchema={"type": "object", "properties": {}}
        ),
        Tool(
            name="send_template_message",
            description="Send a template message to a phone number",
            inputSchema={
                "type": "object",
                "properties": {
                    "to": {
                        "type": "string",
                        "description": "Recipient phone number (international format, e.g., 56912345678)"
                    },
                    "template_name": {
                        "type": "string",
                        "description": "Name of approved template to use"
                    },
                    "language": {
                        "type": "string",
                        "description": "Language code",
                        "default": "es_CL"
                    },
                    "body_parameters": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Values for template variables {{1}}, {{2}}, etc."
                    },
                    "header_parameters": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Values for header variables (if any)"
                    }
                },
                "required": ["to", "template_name", "body_parameters"]
            }
        ),
        Tool(
            name="send_text_message",
            description="Send a free-form text message to a phone number (only works within 24h customer service window)",
            inputSchema={
                "type": "object",
                "properties": {
                    "to": {
                        "type": "string",
                        "description": "Recipient phone number (international format, e.g., 56912345678)"
                    },
                    "message": {
                        "type": "string",
                        "description": "Text message to send"
                    }
                },
                "required": ["to", "message"]
            }
        ),
        Tool(
            name="get_analytics",
            description="Get message analytics and conversation stats",
            inputSchema={
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "Start date (UNIX timestamp)"
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date (UNIX timestamp)"
                    }
                }
            }
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Execute a tool"""

    if name == "list_templates":
        fields = "name,status,category,language,components,quality_score"
        result = await make_request("GET", f"{WABA_ID}/message_templates", {"fields": fields, "limit": 50})

        if "data" in result:
            templates = result["data"]
            if arguments.get("status"):
                templates = [t for t in templates if t.get("status") == arguments["status"]]
            if arguments.get("category"):
                templates = [t for t in templates if t.get("category") == arguments["category"]]

            output = "## WhatsApp Templates\n\n"
            output += "| Name | Category | Status | Language |\n"
            output += "|------|----------|--------|----------|\n"
            for t in templates:
                output += f"| {t['name']} | {t.get('category', 'N/A')} | {t.get('status', 'N/A')} | {t.get('language', 'N/A')} |\n"
            output += f"\n**Total: {len(templates)} templates**"
            return [TextContent(type="text", text=output)]
        return [TextContent(type="text", text=f"Error: {json.dumps(result)}")]

    elif name == "get_template":
        if arguments.get("template_id"):
            fields = "name,status,category,language,components,quality_score"
            result = await make_request("GET", f"{arguments['template_id']}", {"fields": fields})
        else:
            result = await make_request("GET", f"{WABA_ID}/message_templates",
                {"fields": "name,status,category,language,components", "name": arguments.get("template_name")})
            if "data" in result and result["data"]:
                result = result["data"][0]
        return [TextContent(type="text", text=json.dumps(result, indent=2, ensure_ascii=False))]

    elif name == "create_template":
        try:
            log(f"Creating template: {arguments.get('name')}")
            components = []

            if arguments.get("header_text"):
                components.append({
                    "type": "HEADER",
                    "format": "TEXT",
                    "text": arguments["header_text"]
                })

            body_component = {
                "type": "BODY",
                "text": arguments["body_text"],
                "example": {
                    "body_text": [arguments["body_examples"]]
                }
            }
            components.append(body_component)

            if arguments.get("footer_text"):
                components.append({
                    "type": "FOOTER",
                    "text": arguments["footer_text"]
                })

            if arguments.get("buttons"):
                button_component = {"type": "BUTTONS", "buttons": []}
                for btn in arguments["buttons"]:
                    if btn["type"] == "QUICK_REPLY":
                        button_component["buttons"].append({
                            "type": "QUICK_REPLY",
                            "text": btn["text"]
                        })
                    elif btn["type"] == "URL":
                        button_component["buttons"].append({
                            "type": "URL",
                            "text": btn["text"],
                            "url": btn["url"]
                        })
                components.append(button_component)

            payload = {
                "name": arguments["name"],
                "category": arguments["category"],
                "language": arguments.get("language", "es_CL"),
                "components": components
            }

            log(f"Sending request to Meta API...")
            result = await make_request("POST", f"{WABA_ID}/message_templates", payload)
            log(f"Meta API response: {json.dumps(result)}")

            if "id" in result:
                msg = f"Template created successfully!\n\n- **ID**: {result['id']}\n- **Status**: {result.get('status', 'PENDING')}\n- **Category**: {result.get('category', arguments['category'])}"
                log(f"Success: {msg}")
                return [TextContent(type="text", text=msg)]

            error_msg = f"Error creating template: {json.dumps(result, indent=2)}"
            log(f"Error: {error_msg}")
            return [TextContent(type="text", text=error_msg)]
        except Exception as e:
            error_msg = f"Exception creating template: {str(e)}\n{traceback.format_exc()}"
            log(error_msg)
            return [TextContent(type="text", text=error_msg)]

    elif name == "delete_template":
        result = await make_request("DELETE", f"{WABA_ID}/message_templates",
            {"name": arguments["template_name"]})
        if result.get("success"):
            return [TextContent(type="text", text=f"Template '{arguments['template_name']}' deleted successfully")]
        return [TextContent(type="text", text=f"Error: {json.dumps(result)}")]

    elif name == "get_account_info":
        fields = "id,name,currency,timezone_id,message_template_namespace,account_review_status,business_verification_status"
        result = await make_request("GET", WABA_ID, {"fields": fields})
        return [TextContent(type="text", text=f"## WABA Account Info\n\n```json\n{json.dumps(result, indent=2)}\n```")]

    elif name == "get_phone_numbers":
        fields = "id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,status"
        result = await make_request("GET", f"{WABA_ID}/phone_numbers", {"fields": fields})
        if "data" in result:
            output = "## Phone Numbers\n\n"
            for phone in result["data"]:
                output += f"- **{phone.get('display_phone_number')}** ({phone.get('verified_name')})\n"
                output += f"  - Quality: {phone.get('quality_rating', 'N/A')}\n"
                output += f"  - Limit: {phone.get('messaging_limit_tier', 'N/A')}\n"
                output += f"  - ID: {phone.get('id')}\n\n"
            return [TextContent(type="text", text=output)]
        return [TextContent(type="text", text=f"Error: {json.dumps(result)}")]

    elif name == "send_template_message":
        components = []

        if arguments.get("header_parameters"):
            components.append({
                "type": "header",
                "parameters": [{"type": "text", "text": p} for p in arguments["header_parameters"]]
            })

        if arguments.get("body_parameters"):
            components.append({
                "type": "body",
                "parameters": [{"type": "text", "text": p} for p in arguments["body_parameters"]]
            })

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": arguments["to"],
            "type": "template",
            "template": {
                "name": arguments["template_name"],
                "language": {"code": arguments.get("language", "es_CL")},
                "components": components
            }
        }

        result = await make_request("POST", f"{PHONE_NUMBER_ID}/messages", payload)

        if "messages" in result:
            msg_id = result["messages"][0]["id"]
            return [TextContent(type="text", text=f"Message sent successfully!\n\n- **Message ID**: {msg_id}\n- **To**: {arguments['to']}")]
        return [TextContent(type="text", text=f"Error sending message: {json.dumps(result, indent=2)}")]

    elif name == "send_text_message":
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": arguments["to"],
            "type": "text",
            "text": {
                "body": arguments["message"]
            }
        }

        result = await make_request("POST", f"{PHONE_NUMBER_ID}/messages", payload)

        if "messages" in result:
            msg_id = result["messages"][0]["id"]
            return [TextContent(type="text", text=f"Text message sent!\n\n- **Message ID**: {msg_id}\n- **To**: {arguments['to']}")]
        return [TextContent(type="text", text=f"Error sending message: {json.dumps(result, indent=2)}")]

    elif name == "get_analytics":
        params = {
            "fields": "conversation_analytics.start(start_date).end(end_date).granularity(DAILY).dimensions(conversation_type,conversation_direction)",
        }
        if arguments.get("start_date"):
            params["start"] = arguments["start_date"]
        if arguments.get("end_date"):
            params["end"] = arguments["end_date"]

        result = await make_request("GET", WABA_ID, params)
        return [TextContent(type="text", text=f"## Analytics\n\n```json\n{json.dumps(result, indent=2)}\n```")]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


@server.list_resources()
async def list_resources() -> list[Resource]:
    """List available resources"""
    return [
        Resource(
            uri="whatsapp://templates",
            name="WhatsApp Templates",
            description="All message templates in the account",
            mimeType="application/json"
        ),
        Resource(
            uri="whatsapp://account",
            name="Account Info",
            description="WhatsApp Business Account information",
            mimeType="application/json"
        )
    ]


@server.read_resource()
async def read_resource(uri: str) -> str:
    """Read a resource"""
    if uri == "whatsapp://templates":
        result = await make_request("GET", f"{WABA_ID}/message_templates",
            {"fields": "name,status,category,language,components", "limit": 50})
        return json.dumps(result, indent=2, ensure_ascii=False)
    elif uri == "whatsapp://account":
        result = await make_request("GET", WABA_ID,
            {"fields": "id,name,currency,timezone_id,message_template_namespace"})
        return json.dumps(result, indent=2, ensure_ascii=False)
    return "{}"


async def main():
    """Run the MCP server"""
    if not META_ACCESS_TOKEN:
        print("Error: META_ACCESS_TOKEN environment variable not set")
        return
    if not WABA_ID:
        print("Error: META_WABA_ID environment variable not set")
        return

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
