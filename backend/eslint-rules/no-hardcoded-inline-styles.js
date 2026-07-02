/**
 * ESLint rule: no-hardcoded-inline-styles
 *
 * Flags hardcoded color values (hex, rgb/rgba, hsl/hsla) in JSX inline style
 * objects. CSS variable references (var(--*)) and non-color properties are
 * allowed. This enforces the design-system migration: colors should come from
 * Tailwind utilities or CSS variables, not hardcoded literals.
 *
 * Flagged:   style={{ color: '#fff' }}
 * Flagged:   style={{ background: 'rgb(0,0,0)' }}
 * Allowed:   style={{ color: 'var(--text-primary)' }}
 * Allowed:   style={{ display: 'flex' }}
 * Allowed:   style={{ fontSize: 14 }}
 */

const COLOR_HEX_RE = /^#([0-9a-fA-F]{3,8})$/;
const COLOR_FUNC_RE = /^(rgba?|hsla?)\s*\(/;

const COLOR_PROPS = new Set([
  'color',
  'background',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'boxShadow',
  'textShadow',
  'textDecorationColor',
  'fill',
  'stroke',
  'caretColor',
  'accentColor',
  'columnRuleColor',
]);

const noHardcodedInlineStyles = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow hardcoded color values in JSX inline styles',
      recommended: false,
    },
    messages: {
      hardcodedColor:
        'Hardcoded color "{{ value }}" in inline style. Use a CSS variable (var(--*)) or Tailwind utility instead.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.name !== 'style') return;
        if (!node.value) return;
        const expr =
          node.value.type === 'JSXExpressionContainer'
            ? node.value.expression
            : null;
        if (!expr || expr.type !== 'ObjectExpression') return;

        for (const prop of expr.properties) {
          if (prop.type !== 'Property') continue;

          const keyName =
            prop.key.type === 'Identifier'
              ? prop.key.name
              : prop.key.type === 'Literal'
                ? String(prop.key.value)
                : null;
          if (!keyName) continue;

          const val = prop.value;

          // Numeric literals are fine (fontSize: 14, padding: 8)
          if (val.type === 'Literal' && typeof val.value === 'number') continue;

          // String literals — check if it's a color property with a hardcoded color
          if (val.type === 'Literal' && typeof val.value === 'string') {
            const str = val.value.trim();

            // Always allow CSS variable references
            if (str.includes('var(')) continue;
            // Allow pure keyword values (inherit, transparent, currentColor, none, etc.)
            if (/^[a-zA-Z]+$/.test(str)) continue;

            const isHardcodedColor =
              COLOR_HEX_RE.test(str) || COLOR_FUNC_RE.test(str);

            if (isHardcodedColor) {
              context.report({
                node: val,
                messageId: 'hardcodedColor',
                data: { value: str },
              });
            }
          }

          // Template literals with hardcoded colors
          if (val.type === 'TemplateLiteral' && val.quasis.length === 1) {
            const str = (val.quasis[0].value.raw || '').trim();
            if (str.includes('var(')) continue;
            if (/^[a-zA-Z]+$/.test(str)) continue;

            const isHardcodedColor =
              COLOR_HEX_RE.test(str) || COLOR_FUNC_RE.test(str);

            if (isHardcodedColor) {
              context.report({
                node: val,
                messageId: 'hardcodedColor',
                data: { value: str },
              });
            }
          }
        }
      },
    };
  },
};

export const phoenixStyles = {
  rules: {
    'no-hardcoded-inline-styles': noHardcodedInlineStyles,
  },
};
