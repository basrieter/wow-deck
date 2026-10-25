// @ts-check

import stylisticLint from "@stylistic/eslint-plugin";
import typescriptLint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";

export default [
    stylisticLint.configs["recommended"],
    ...typescriptLint.configs["recommended"],
    {
        plugins: {
            "@stylistic": stylistic
        },
        rules: {
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/no-inferrable-types": "off",
            "@typescript-eslint/no-unused-vars": "warn",
            "@stylistic/semi": ["error", "always"],
            "@stylistic/indent": ["error", 4, {
                FunctionExpression: {
                    parameters: "first", // Keeps parameters aligned in the same line
                    body: 1 // Controls indentation inside constructor and function bodies
                },
                SwitchCase: 1
            }],
            "@stylistic/lines-between-class-members": [
                "error",
                "always",
                {
                    exceptAfterSingleLine: true
                }
            ],
            "@stylistic/indent-binary-ops": ["error", 4],
            "@stylistic/quotes": ["warn", "double"],
            "@stylistic/comma-dangle": ["error", "never"],
            "@stylistic/ts/quote-props": ["off"],
            "@stylistic/keyword-spacing": ["warn"],
            "@stylistic/brace-style": ["error", "stroustrup"],
            "@stylistic/member-delimiter-style": ["error", {
                multiline: {
                    delimiter: "semi",
                    requireLast: true
                },
                singleline: {
                    delimiter: "semi",
                    requireLast: false
                },
                multilineDetection: "brackets"
            }],
            "curly": ["error", "all"]
        }
    },
    {
        ignores: [
            "node_modules/",
            "dist/",
            "karma.conf.js",
            "**/*.py"
        ]
    }
];
