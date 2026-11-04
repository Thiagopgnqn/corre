import glob

files = glob.glob('src/components/admin/tabs/*.tsx')
for path in files:
    with open(path, 'r', encoding='utf-8') as f:
        c = f.read()
    if 'z-50' in c:
        c = c.replace('z-50', 'z-[var(--z-modal)]')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(c)
        print(f"Patched {path}")

