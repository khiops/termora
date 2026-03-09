/**
 * Emoji shortcode map -- ~130 common shortcodes.
 * Keys are lowercase without colons; values are the emoji characters.
 */
export const EMOJI_SHORTCODES: Map<string, string> = new Map([
	// Technology & infrastructure
	["rocket", "🚀"],
	["computer", "💻"],
	["desktop_computer", "🖥️"],
	["keyboard", "⌨️"],
	["mouse", "🖱️"],
	["printer", "🖨️"],
	["floppy_disk", "💾"],
	["cd", "💿"],
	["dvd", "📀"],
	["phone", "📱"],
	["telephone", "☎️"],
	["battery", "🔋"],
	["electric_plug", "🔌"],
	["bulb", "💡"],
	["flashlight", "🔦"],
	["satellite", "🛰️"],
	["antenna", "📡"],
	["pager", "📟"],
	["tv", "📺"],
	["radio", "📻"],
	["camera", "📷"],
	["video_camera", "📹"],

	// Server & network
	["database", "🗄️"],
	["cloud", "☁️"],
	["globe_with_meridians", "🌐"],
	["globe", "🌍"],
	["link", "🔗"],
	["signal_strength", "📶"],
	["wifi", "📶"],

	// Security
	["lock", "🔒"],
	["unlock", "🔓"],
	["key", "🔑"],
	["old_key", "🗝️"],
	["shield", "🛡️"],
	["warning", "⚠️"],
	["no_entry", "⛔"],
	["stop_sign", "🛑"],
	["closed_lock_with_key", "🔐"],

	// Files & folders
	["file_folder", "📁"],
	["open_file_folder", "📂"],
	["folder", "📁"],
	["card_index_dividers", "🗂️"],
	["page_facing_up", "📄"],
	["page_with_curl", "📃"],
	["memo", "📝"],
	["clipboard", "📋"],
	["spiral_notepad", "🗒️"],
	["wastebasket", "🗑️"],
	["inbox_tray", "📥"],
	["outbox_tray", "📦"],
	["package", "📦"],
	["label", "🏷️"],
	["bookmark", "🔖"],
	["books", "📚"],
	["book", "📖"],

	// Tools & settings
	["gear", "⚙️"],
	["wrench", "🔧"],
	["hammer", "🔨"],
	["hammer_and_wrench", "🛠️"],
	["nut_and_bolt", "🔩"],
	["toolbox", "🧰"],
	["magnifying_glass", "🔍"],
	["mag", "🔍"],
	["mag_right", "🔎"],
	["microscope", "🔬"],
	["telescope", "🔭"],
	["test_tube", "🧪"],
	["alembic", "⚗️"],

	// Status & indicators
	["white_check_mark", "✅"],
	["check", "✔️"],
	["x", "❌"],
	["cross_mark", "❌"],
	["question", "❓"],
	["exclamation", "❗"],
	["bangbang", "‼️"],
	["zap", "⚡"],
	["fire", "🔥"],
	["tada", "🎉"],
	["sparkles", "✨"],
	["star", "⭐"],
	["star2", "🌟"],
	["stars", "🌠"],
	["new", "🆕"],
	["up", "🆙"],
	["ok", "🆗"],
	["cool", "🆒"],

	// Nature & misc
	["seedling", "🌱"],
	["herb", "🌿"],
	["leaves", "🍃"],
	["snowflake", "❄️"],
	["rainbow", "🌈"],
	["sunny", "☀️"],
	["moon", "🌙"],
	["earth_americas", "🌎"],
	["ocean", "🌊"],
	["wave", "🌊"],

	// Symbols & arrows
	["recycle", "♻️"],
	["infinity", "♾️"],
	["arrows_counterclockwise", "🔄"],
	["arrow_right", "➡️"],
	["arrow_left", "⬅️"],
	["arrow_up", "⬆️"],
	["arrow_down", "⬇️"],
	["fast_forward", "⏩"],
	["rewind", "⏪"],

	// People & objects
	["heart", "❤️"],
	["blue_heart", "💙"],
	["green_heart", "💚"],
	["bug", "🐛"],
	["ant", "🐜"],
	["robot", "🤖"],
	["ghost", "👻"],
	["alien", "👽"],
	["crown", "👑"],
	["trophy", "🏆"],
	["medal", "🏅"],
	["dart", "🎯"],
	["game_die", "🎲"],
	["jigsaw", "🧩"],

	// Places & travel
	["house", "🏠"],
	["office", "🏢"],
	["factory", "🏭"],
	["hospital", "🏥"],
	["school", "🏫"],
	["european_castle", "🏰"],
	["city", "🌆"],
	["airplane", "✈️"],
	["ship", "🚢"],
	["train", "🚂"],
	["car", "🚗"],
]);

/**
 * Resolve an emoji shortcode like `:rocket:` to its emoji character.
 * - Matching is case-insensitive.
 * - If the input is not a shortcode pattern or the shortcode is unknown, returns the input as-is.
 */
export function resolveEmojiShortcode(input: string): string {
	const match = /^:([a-zA-Z0-9_]+):$/.exec(input.trim());
	if (!match) return input;
	const key = (match[1] as string).toLowerCase();
	return EMOJI_SHORTCODES.get(key) ?? input;
}
