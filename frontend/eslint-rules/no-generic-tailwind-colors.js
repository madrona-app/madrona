const FORBIDDEN_COLORS = [
  'white', 'black', 'gray', 'slate', 'zinc', 'neutral', 'blue', 'green', 'red',
  'amber', 'yellow', 'orange', 'emerald', 'indigo', 'purple', 'violet', 'teal',
  'cyan', 'rose', 'fuchsia', 'pink', 'lime', 'sky',
];

const FORBIDDEN_PATTERN = new RegExp(
  '\\b(?:text|bg|border|ring|divide|outline|shadow|accent|caret|fill|stroke)-(?:' +
    FORBIDDEN_COLORS.join('|') +
    ')(?:-\\d+)?(?:\\/\\d+)?\\b'
);

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow generic Tailwind color classes; use Madrona palette instead',
    },
    messages: {
      forbidden:
        'Generic Tailwind color "{{className}}" is not allowed. Use the Madrona palette (ink, parchment, lichen, stone, archive, forest, bark, copper, semantic-*, viz-*).',
    },
  },
  create(context) {
    function checkString(node, value) {
      const globalPattern = new RegExp(FORBIDDEN_PATTERN.source, 'g');
      const matches = value.match(globalPattern);
      if (matches) {
        matches.forEach((className) => {
          context.report({ node, messageId: 'forbidden', data: { className } });
        });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') checkString(node, node.value);
      },
      TemplateLiteral(node) {
        node.quasis.forEach((quasi) => checkString(node, quasi.value.raw));
      },
    };
  },
};
