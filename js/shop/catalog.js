// Katalog aller kaufbaren Artikel. Owner: Thread "Shop".
// Andere Module duerfen den Katalog lesen (import), aber nicht aendern.
//
// Form eines Eintrags:
// { type, name, category: 'switch'|'server'|'router'|'patchpanel'|'cable',
//   price, units, ports: [{ name, kind: 'rj45'|'sfp'|'power' }] }

export const CATALOG = [
  {
    type: 'switch-24',
    name: 'Switch 24 Port',
    category: 'switch',
    price: 300,
    units: 1,
    ports: Array.from({ length: 24 }, (_, i) => ({ name: `ge${i + 1}`, kind: 'rj45' })),
  },
  {
    type: 'server-1u',
    name: 'Server 1U',
    category: 'server',
    price: 500,
    units: 1,
    ports: [{ name: 'eth0', kind: 'rj45' }, { name: 'eth1', kind: 'rj45' }],
  },
  {
    type: 'cable-cat6',
    name: 'Cat6 Kabel',
    category: 'cable',
    price: 5,
    units: 0,
    ports: [],
  },
];

export function getItem(type) {
  return CATALOG.find((item) => item.type === type);
}
