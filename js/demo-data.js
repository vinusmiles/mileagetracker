// Clearly labelled sample data for trying the app. Every record carries
// demo: true and can be removed in one tap from Settings.
// The data is generated relative to today, so the dashboard always has
// a current month to show. A seeded random generator keeps it repeatable.

import { addDays } from './core/dates.js';
import { round2 } from './core/calc.js';

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function simulate({ vehicleId, today, rand, startOdo, daysBack, everyDays, kmPerDay, kmPerLitre, tank, price, partialAmount, stations, makeId, stamp }) {
  const entries = [];
  let odo = startOdo;
  let level = tank * 0.55;
  let day = daysBack;
  let i = 0;
  while (day >= 1) {
    const date = addDays(today, -day);
    const p = round2(price + (rand() - 0.5) * 2);
    let quantity;
    let total;
    let full;
    if (i === 0 || i % 4 !== 2) {
      full = true;
      quantity = round2(tank - level);
      total = round2(quantity * p);
      level = tank;
    } else {
      full = false;
      total = partialAmount;
      quantity = round2(total / p);
      level = Math.min(tank, level + quantity);
    }
    entries.push({
      id: makeId(), vehicleId, date, quantity, unit: 'L',
      pricePerUnit: p, totalAmount: total,
      station: stations[i % stations.length], odometer: Math.round(odo),
      fullTank: full, notes: '', calculated: full ? ['totalAmount'] : ['quantity'],
      demo: true, createdAt: stamp, updatedAt: stamp,
    });
    const days = everyDays + Math.round((rand() - 0.5) * 4);
    const km = kmPerDay * days * (0.85 + rand() * 0.3);
    odo += km;
    level -= km / (kmPerLitre * (0.95 + rand() * 0.1));
    if (level < 0.3) level = 0.3;
    day -= days;
    i += 1;
  }
  return entries;
}

export function buildDemoData(today, makeId) {
  const stamp = new Date().toISOString();
  const rand = seeded(42);
  const bikeId = makeId();
  const carId = makeId();
  const vehicles = [
    {
      id: bikeId, nickname: 'Sample scooter', type: 'two', make: 'Honda', model: 'Activa 6G',
      registration: '', fuelType: 'petrol', initialOdometer: 12040, demo: true, createdAt: stamp, updatedAt: stamp,
    },
    {
      id: carId, nickname: 'Sample family car', type: 'four', make: 'Maruti Suzuki', model: 'Swift',
      registration: 'KA 01 AB 1234', fuelType: 'petrol', initialOdometer: 38210, demo: true,
      createdAt: new Date(Date.now() + 1).toISOString(), updatedAt: stamp,
    },
  ];
  const entries = [
    ...simulate({
      vehicleId: bikeId, today, rand, makeId, stamp, startOdo: 12040, daysBack: 160, everyDays: 9,
      kmPerDay: 17, kmPerLitre: 47, tank: 5.3, price: 104, partialAmount: 200,
      stations: ['HP, Ring Road', 'Indian Oil, Main Road', 'Bharat Petroleum, Highway'],
    }),
    ...simulate({
      vehicleId: carId, today, rand, makeId, stamp, startOdo: 38210, daysBack: 165, everyDays: 13,
      kmPerDay: 30, kmPerLitre: 17, tank: 37, price: 104, partialAmount: 1000,
      stations: ['Indian Oil, Main Road', 'Shell, Outer Ring Road'],
    }),
  ];
  return { vehicles, entries };
}
