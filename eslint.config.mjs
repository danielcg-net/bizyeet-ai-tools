import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "eslint.config.mjs"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "array-callback-return": "error",
      "no-await-in-loop": "error",
      "no-continue": "error",
      "no-param-reassign": ["error", { "props": true }],
      "no-restricted-syntax": [
        "error",
        { "selector": "AssignmentExpression[left.type='MemberExpression']", "message": "Mutate neither objects nor arrays; return a new value." },
        { "selector": "ClassDeclaration", "message": "Use functions instead of classes." },
        { "selector": "ForInStatement", "message": "Use declarative operations instead of loops." },
        { "selector": "ForOfStatement", "message": "Use declarative operations instead of loops." },
        { "selector": "ForStatement", "message": "Use declarative operations instead of loops." },
        { "selector": "ThisExpression", "message": "Use explicit functional dependencies instead of this." },
        { "selector": "UpdateExpression", "message": "Avoid mutation; derive a new value." },
        { "selector": "VariableDeclaration[kind='let']", "message": "Use const bindings; derive new values instead of reassigning variables." },
        { "selector": "VariableDeclaration[kind='var']", "message": "Use const bindings; var is not permitted." },
        { "selector": "WhileStatement", "message": "Use declarative operations instead of loops." }
      ],
      "prefer-const": "error"
    }
  },
);
