# Discord System

This system owns shared Discord API infrastructure once behavior is reused outside startup.

The current REST wrapper syncs guild commands and sends interaction responses. It owns Discordeno REST construction so callers do not access the REST manager directly. String responses are sent as Components V2 text displays by default. Pass a Discord message payload object when a response needs explicit payload control, including legacy `content`.

Add Discord REST behavior to this wrapper before exposing raw REST manager access elsewhere.

The Discord event router handles raw gateway payload routing for ready events, message create events, and interactions. It builds command and component lookups once and passes handlers a context with Discord REST helpers. Keep it small and route feature behavior to the owning command package, module, or system.
