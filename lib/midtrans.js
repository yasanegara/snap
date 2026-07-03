const midtransClient = require('midtrans-client');

const IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || '';

// Harga langganan Pro (bisa diubah sesuai kebutuhan)
const PRO_PRICE = 149000; // per bulan, dalam Rupiah

function getSnap() {
  return new midtransClient.Snap({
    isProduction: IS_PRODUCTION,
    serverKey: SERVER_KEY,
    clientKey: CLIENT_KEY
  });
}

function getCoreApi() {
  return new midtransClient.CoreApi({
    isProduction: IS_PRODUCTION,
    serverKey: SERVER_KEY,
    clientKey: CLIENT_KEY
  });
}

async function createProCheckout(org, user) {
  const orderId = 'PRO-' + org.id + '-' + Date.now();
  const snap = getSnap();
  const transaction = await snap.createTransaction({
    transaction_details: {
      order_id: orderId,
      gross_amount: PRO_PRICE
    },
    customer_details: {
      email: user.email
    },
    item_details: [
      {
        id: 'pro-monthly',
        price: PRO_PRICE,
        quantity: 1,
        name: 'Live Preview Studio - Pro (1 bulan)'
      }
    ]
  });
  return { orderId, token: transaction.token, redirectUrl: transaction.redirect_url };
}

module.exports = { getSnap, getCoreApi, createProCheckout, PRO_PRICE, CLIENT_KEY };
