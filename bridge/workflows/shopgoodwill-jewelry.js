// ShopGoodwill Jewelry Auction Scraper Workflow
// Finds jewelry lots on shopgoodwill.com with prices and time remaining

export const shopgoodwillJewelryWorkflow = {
  id: 'shopgoodwill-jewelry',
  name: 'ShopGoodwill Jewelry Auctions',
  description: 'Find jewelry lots on shopgoodwill.com with prices, bids, and time remaining',
  version: '1.0',
  steps: [
    {
      id: 'navigate-home',
      name: 'Navigate to ShopGoodwill',
      skill: 'agent-start',
      input: {
        task: 'Go to https://www.shopgoodwill.com and wait for page to load completely',
      },
      dependsOn: [],
      outputMap: {
        navigateHome: {
          url: 'currentUrl',
        },
      },
    },
    {
      id: 'search-jewelry',
      name: 'Search/Navigate to Jewelry Category',
      skill: 'agent-start',
      input: {
        task: 'Navigate to the jewelry category on shopgoodwill.com. Look for "Jewelry" in navigation or use search for "jewelry lots". Wait for results to load.',
      },
      dependsOn: ['navigate-home'],
      outputMap: {
        searchJewelry: {
          pageUrl: 'jewelryPageUrl',
        },
      },
    },
    {
      id: 'extract-listings',
      name: 'Extract Jewelry Listings',
      skill: 'agent-start',
      input: {
        task: 'On the jewelry results page, extract all current auction listings. For each listing, get: item title, current price/bid, time remaining, number of bids, item URL. Handle pagination if needed to get more results. Return structured data as JSON.',
      },
      dependsOn: ['search-jewelry'],
      outputMap: {
        extractListings: {
          listings: 'jewelryListings',
        },
      },
    },
    {
      id: 'filter-lots',
      name: 'Filter for Jewelry Lots',
      skill: 'data-extract',
      input: {
        data: '{{extractListings.listings}}',
        format: 'json',
        schema: {
          type: 'array',
          items: {
            title: 'string',
            currentPrice: 'string',
            timeRemaining: 'string',
            bidCount: 'string',
            url: 'string',
            isLot: 'boolean',
          },
        },
      },
      dependsOn: ['extract-listings'],
      outputMap: {
        filterLots: {
          filteredListings: 'lotListings',
        },
      },
    },
    {
      id: 'generate-report',
      name: 'Generate Auction Report',
      skill: 'write-blog',
      input: {
        topic: 'ShopGoodwill Jewelry Lot Auctions - Current Listings',
        outline: {
          summary: 'Executive summary of total lots found, price ranges, and ending soon',
          allListings: '{{filterLots.filteredListings}}',
          endingSoon: 'Items ending within 1 hour',
          topBids: 'Items with highest current bids',
        },
        style: 'professional auction report with clear tables',
      },
      dependsOn: ['filter-lots'],
      outputMap: {
        generateReport: {
          report: 'auctionReport',
        },
      },
    },
  ],
  metadata: {
    category: 'shopping',
    tags: ['shopgoodwill', 'jewelry', 'auctions', 'scraping'],
    requiredParams: [],
    estimatedDuration: '3-5 minutes',
  },
};