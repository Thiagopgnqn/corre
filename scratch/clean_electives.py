with open('src/components/electives/ElectivesPicker.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace("import { BottomSheet } from '../common/BottomSheet';\n", "")
c = c.replace("import { BottomSheet } from '../common/BottomSheet';\r\n", "")
with open('src/components/electives/ElectivesPicker.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
print("Cleaned ElectivesPicker")

