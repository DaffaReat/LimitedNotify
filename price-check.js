const axios = require('axios');

// Note: this endpoint is rate-limited to 1 request per minute and
// is cached server-side, so don't call it more often than that.
const ASSET_ID = "4390890198";

async function checkPrice() {
    try {
        const response = await axios.get('https://www.rolimons.com/itemapi/itemdetails', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.rolimons.com/'
            }
        });

        const items = response.data.items;

        if (!items || !items[ASSET_ID]) {
            console.log("item not found in Rolimons database");
            return;
        }

        const itemData = items[ASSET_ID];
        // Array mapping: [name, acronym, rap, value, defaultValue, demand, trend, projected, hyped, rare]
        const name = itemData[0];
        const rap = itemData[2];
        const value = itemData[3];

        console.log(`Item: ${name}`);
        console.log(`RAP: ${rap}`);
        console.log(`Value: ${value}`);

    } catch (error) {
        if (error.response) {
            console.error(`HTTP Error: ${error.response.status} - ${error.response.statusText}`);
        } else {
            console.error(`Error: ${error.message}`);
        }
    }
}

checkPrice();
