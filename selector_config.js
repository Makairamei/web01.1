// ============================================================
// SELECTOR CONFIG — Konfigurasi CSS Selector per Plugin
// File ini TIDAK boleh dipublikasikan / di-commit ke repo publik
// Selector ini yang digunakan plugin untuk menemukan link video
// ============================================================

module.exports = {

    // ─── Plugin Anime/Series (scraper HTML) ─────────────────

    // NOTE: Key harus PERSIS sama dengan `override var name` di plugin.
    // Banyak plugin pakai emoji, jadi key di bawah ini mengandung emoji juga.

    "AnimeSail\uD83C\uDF5F": {  // "AnimeSail🍟"
        server_selector: ".mobius > .mirror > option",
        value_attr: "data-em",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "Anichin \uD83D\uDD25": {  // "Anichin 🔥" (dengan spasi)
        server_selector: ".mobius option",
        value_attr: "value",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "Donghub\uD83D\uDC09": {  // "Donghub🐉"
        server_selector: ".mobius option",
        value_attr: "value",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "Samehadaku\u26E9\uFE0F": {  // "Samehadaku⛩️"
        server_selector: "div#downloadb li",
        link_selector: "a",
        quality_selector: "strong",
        type: "download_links"
    },

    // ─── Plugin API-based (pakai secret key) ─────────────────

    "MovieBox\uD83D\uDCE6": {
        // secret key untuk generate HMAC signature
        // JANGAN pernah hardcode ini di plugin
        secret_key_default: "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O",
        secret_key_alt: "Xqn2nnO41/L92o1iuXhSLHTbXvY4Z5ZZ62m8mSLA",
        type: "api_secret"
    }

};
