export default {
  name: 'Staybook',
  description: 'Poolside Modernism Boutique Hotel Operations Dashboard & Room Booking System',
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  host: '0.0.0.0',
  databasePath: 'data/staybook.db',
  currency: {
    code: 'INR',
    symbol: '₹',
    locale: 'en-IN'
  }
};
