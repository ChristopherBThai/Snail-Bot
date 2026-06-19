# Discord System

This system owns shared Discord API infrastructure once behavior is reused outside startup.

The current adapter syncs guild commands and sends initial interaction responses. It owns Discordeno REST construction so callers do not access the REST manager directly. String responses are sent as Components V2 text displays by default. Pass a Discord message payload object when a response needs explicit payload control, including legacy `content`.

Add Discord API behavior to this adapter before exposing raw REST access elsewhere.

The current interaction router handles raw gateway payload routing for application commands. It builds a command lookup once and passes handlers an interaction context with `interaction` and `respond`. Keep it small until there is enough command behavior to justify command packages.
