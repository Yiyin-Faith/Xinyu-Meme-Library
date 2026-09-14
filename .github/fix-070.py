from pathlib import Path

p = Path('src/components/VisualCropper.tsx')
text = p.read_text(encoding='utf-8')
text = text.replace('const interaction = useRef<Interaction>();', 'const interaction = useRef<Interaction | null>(null);')
text = text.replace('interaction.current = undefined;', 'interaction.current = null;')
p.write_text(text, encoding='utf-8')
