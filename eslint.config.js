import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", ".worktrees/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process:       "readonly",
        console:       "readonly",
        Buffer:        "readonly",
        setTimeout:    "readonly",
        clearTimeout:  "readonly",
        setInterval:   "readonly",
        clearInterval: "readonly",
        URL:             "readonly",
        URLSearchParams: "readonly",
        fetch:           "readonly",
        AbortController: "readonly",
        AbortSignal:     "readonly",
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-undef": "error"
    }
  },
  {
    files: ["assets/**/*.js"],
    languageOptions: {
      globals: {
        document:              "readonly",
        window:                "readonly",
        sessionStorage:        "readonly",
        localStorage:          "readonly",
        navigator:             "readonly",
        Node:                  "readonly",
        location:              "readonly",
        history:               "readonly",
        HTMLElement:            "readonly",
        customElements:        "readonly",
        Event:                 "readonly",
        CustomEvent:           "readonly",
        MutationObserver:      "readonly",
        IntersectionObserver:  "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame:  "readonly",
        getComputedStyle:      "readonly",
        DOMParser:             "readonly",
        XMLSerializer:         "readonly",
        btoa:                  "readonly",
        atob:                  "readonly",
        self:                  "readonly",
        confirm:               "readonly",
        alert:                 "readonly",
        prompt:                "readonly",
      }
    }
  },
  {
    files: ["tests/**/*.test.js"],
    languageOptions: {
      globals: {
        describe:   "readonly",
        it:         "readonly",
        test:       "readonly",
        expect:     "readonly",
        beforeAll:  "readonly",
        afterAll:   "readonly",
        beforeEach: "readonly",
        afterEach:  "readonly",
        jest:       "readonly",
        module:     "readonly",
      }
    }
  }
];
