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

    "Animasu\uD83D\uDC30": {
        server_selector: ".mobius > .mirror > option",
        value_attr: "value",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "Anoboy\u26A1": {
        iframe_selector: "iframe#mediaplayer, iframe#videoembed, div.player-embed iframe, iframe[src], iframe[data-src], iframe[data-litespeed-src]",
        iframe_attr: "data-litespeed-src",
        iframe_fallback_attr: "data-src",
        iframe_second_fallback_attr: "src",
        upload_selector: "a[href*=\"yourupload.com/embed/\"], a[href*=\"yourupload.com/watch/\"], a[href*=\"www.yourupload.com/embed/\"], a[href*=\"www.yourupload.com/watch/\"]",
        batch_selector: "a[href*=\"/uploads/stream/embed.php\"], a[href*=\"/uploads/acbatch.php\"], a[href*=\"/uploads/adsbatch\"], a[href*=\"/uploads/yupbatch\"], a[href*=\"blogger.com/video.g\"], a[href*=\"blogger.googleusercontent.com\"]",
        data_video_selector: "#fplay a#allmiror[data-video], #fplay a[data-video], a#allmiror[data-video], a[data-video], [data-video]",
        data_attr_selector: "[data-embed], [data-iframe], [data-url], [data-src]",
        download_selector: "div.download a.udl[href], div.download a[href], div.dlbox li span.e a[href]",
        mirror_selector: "select.mirror option[value]:not([disabled])",
        mirror_value_attr: "value",
        mirror_iframe_selector: "iframe",
        type: "crawler"
    },

    "Auratail\uD83D\uDC51": {  // "Auratail👑"
        server_selector: ".mobius option, select option, .mirror option",
        value_attr: "value",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "SeaTV\uD83E\uDEA8": {  // "SeaTV🪸"
        server_selector: ".mobius option",
        value_attr: "value",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "Donghuastream\uD83C\uDC04": {  // "Donghuastream🀄"
        server_selector: "option[data-index]",
        value_attr: "value",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "Layarasia\u26C4": {  // "Layarasia⛄"
        player_selector: "div.player-embed iframe",
        player_attr: "data-litespeed-src",
        player_fallback_attr: "src",
        mirror_selector: "select.mirror option[value]:not([disabled])",
        mirror_value_attr: "value",
        mirror_iframe_selector: "iframe",
        mirror_iframe_attr: "src",
        mirror_iframe_fallback_attr: "data-src",
        download_selector: "div.dlbox li span.e a[href]",
        download_attr: "href",
        type: "multi_source"
    },

    "Donghub\uD83D\uDC09": {  // "Donghub🐉"
        server_selector: ".mobius option",
        value_attr: "value",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "Animexin\uD83D\uDC22": {
        server_selector: ".mobius option",
        value_attr: "value",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "Animekhor\uD83E\uDD84": {
        server_selector: ".mobius option",
        value_attr: "value",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "Donghuaworld\uD83D\uDD4A": {
        server_selector: "div.server-item a",
        value_attr: "data-hash",
        iframe_selector: "iframe",
        iframe_attr: "src",
        encoding: "base64",
        type: "standard"
    },

    "Oppadrama\uD83E\uDDE6": {
        player_selector: "div.player-embed iframe",
        player_attr: "data-litespeed-src",
        player_fallback_attr: "src",
        mirror_selector: "select.mirror option[value]:not([disabled])",
        mirror_value_attr: "value",
        mirror_iframe_selector: "iframe",
        mirror_iframe_attr: "src",
        mirror_iframe_fallback_attr: "data-src",
        download_selector: "div.dlbox li span.e a[href]",
        download_attr: "href",
        encoding: "base64",
        type: "multi_source"
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
