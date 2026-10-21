// Katalog aller kaufbaren Artikel. Owner: Thread "Shop".
// Andere Module duerfen den Katalog lesen (import), aber nicht aendern.
// Racks gibt es nicht im Shop, die kauft die Rack-Ansicht selbst.
//
// Form eines Eintrags:
// { type, name, category, description, price,
//   units,                          Hoeheneinheiten im Rack (0 bei Kabeln)
//   power,                          Stromverbrauch in Watt
//   capacity,                       optional { cpu, ram, storage } fuer Auftraege
//   ports: [{ name, kind: 'rj45'|'sfp'|'power'|'power-out' }],
//   cableType }                     nur bei Kabeln: 'rj45'|'sfp'|'power'

export const CATEGORIES = [
  { id: 'switch', name: 'Switches' },
  { id: 'router', name: 'Router' },
  { id: 'server', name: 'Server' },
  { id: 'storage', name: 'Storage' },
  { id: 'patchpanel', name: 'Patchpanel' },
  { id: 'pdu', name: 'Strom' },
  { id: 'cable', name: 'Kabel' },
];

const ports = (count, kind, prefix) =>
  Array.from({ length: count }, (_, i) => ({ name: `${prefix}${i + 1}`, kind }));
const psu = (count = 1) => ports(count, 'power', 'psu');

export const CATALOG = [
  // Switches
  {
    type: 'switch-8', name: 'Switch 8 Port', category: 'switch',
    description: 'Einfacher Switch fuer kleine Netze.',
    price: 150, units: 1, power: 15,
    ports: [...ports(8, 'rj45', 'ge'), ...psu()],
  },
  {
    type: 'switch-24', name: 'Switch 24 Port', category: 'switch',
    description: 'Access-Switch mit zwei Glasfaser-Uplinks.',
    price: 300, units: 1, power: 30,
    ports: [...ports(24, 'rj45', 'ge'), ...ports(2, 'sfp', 'sfp'), ...psu()],
  },
  {
    type: 'switch-48', name: 'Switch 48 Port', category: 'switch',
    description: 'Viele Ports und vier Glasfaser-Uplinks.',
    price: 700, units: 1, power: 60,
    ports: [...ports(48, 'rj45', 'ge'), ...ports(4, 'sfp', 'sfp'), ...psu()],
  },

  // Router
  {
    type: 'router-basic', name: 'Edge-Router', category: 'router',
    description: 'Internet-Anbindung fuer das Rechenzentrum.',
    price: 450, units: 1, power: 25,
    ports: [...ports(4, 'rj45', 'ge'), ...ports(2, 'sfp', 'sfp'), ...psu()],
  },

  // Server
  {
    type: 'server-1u', name: 'Server 1HE', category: 'server',
    description: 'Einstiegsserver fuer Webhosting.',
    price: 500, units: 1, power: 150,
    capacity: { cpu: 8, ram: 32, storage: 1 },
    ports: [...ports(2, 'rj45', 'eth'), ...psu()],
  },
  {
    type: 'server-2u', name: 'Server 2HE', category: 'server',
    description: 'Mehr Leistung fuer Datenbanken und Apps.',
    price: 1200, units: 2, power: 300,
    capacity: { cpu: 32, ram: 128, storage: 4 },
    ports: [...ports(2, 'rj45', 'eth'), ...ports(2, 'sfp', 'sfp'), ...psu(2)],
  },

  // Storage
  {
    type: 'storage-2u', name: 'Storage 2HE', category: 'storage',
    description: 'Viel Speicherplatz fuer Backups.',
    price: 900, units: 2, power: 120,
    capacity: { cpu: 4, ram: 16, storage: 48 },
    ports: [...ports(2, 'rj45', 'eth'), ...ports(2, 'sfp', 'sfp'), ...psu(2)],
  },

  // Patchpanel
  {
    type: 'patchpanel-24', name: 'Patchpanel 24', category: 'patchpanel',
    description: 'Ordnung in der Verkabelung, braucht keinen Strom.',
    price: 60, units: 1, power: 0,
    ports: ports(24, 'rj45', 'p'),
  },

  // Strom
  {
    type: 'pdu-8', name: 'Stromleiste 8fach', category: 'pdu',
    description: 'Versorgt bis zu acht Geraete mit Strom.',
    price: 120, units: 1, power: 0,
    ports: ports(8, 'power-out', 'out'),
  },
  {
    type: 'ups-2u', name: 'USV 2HE', category: 'pdu',
    description: 'Unterbrechungsfreie Stromversorgung mit vier Ausgaengen.',
    price: 800, units: 2, power: 0,
    ports: ports(4, 'power-out', 'out'),
  },

  // Kabel
  {
    type: 'cable-rj45', name: 'Patchkabel RJ45', category: 'cable',
    description: 'Kupferkabel fuer RJ45-Ports.',
    price: 5, units: 0, power: 0, ports: [], cableType: 'rj45',
  },
  {
    type: 'cable-sfp', name: 'Glasfaserkabel', category: 'cable',
    description: 'Fuer SFP-Ports, schnell und teuer.',
    price: 25, units: 0, power: 0, ports: [], cableType: 'sfp',
  },
  {
    type: 'cable-power', name: 'Stromkabel', category: 'cable',
    description: 'Verbindet ein Geraet mit einer Stromleiste.',
    price: 3, units: 0, power: 0, ports: [], cableType: 'power',
  },
];

export const SELL_RATIO = 0.5;

export function getItem(type) {
  return CATALOG.find((item) => item.type === type);
}

export function sellPrice(item) {
  return Math.floor(item.price * SELL_RATIO);
}

// Kurze Beschriftungen der technischen Daten fuer die Anzeige.
export function specLabels(item) {
  const count = (kind) => item.ports.filter((p) => p.kind === kind).length;
  const out = [];
  if (item.units) out.push(`${item.units} HE`);
  if (count('rj45')) out.push(`${count('rj45')}x RJ45`);
  if (count('sfp')) out.push(`${count('sfp')}x SFP`);
  if (count('power-out')) out.push(`${count('power-out')}x Strom`);
  if (item.capacity) {
    const { cpu, ram, storage } = item.capacity;
    if (cpu) out.push(`${cpu} Kerne`);
    if (ram) out.push(`${ram} GB RAM`);
    if (storage) out.push(`${storage} TB`);
  }
  if (item.power) out.push(`${item.power} W`);
  if (item.cableType) out.push(item.cableType.toUpperCase());
  return out;
}
