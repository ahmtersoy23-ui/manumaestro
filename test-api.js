// Test monthly API
const month = '2026-03';

fetch(`http://localhost:3000/api/requests/monthly?month=${month}`)
  .then(r => r.json())
  .then(data => {
    console.log('Monthly API Response:');
    console.log('Total:', data.data.totalRequests, 'requests');
    console.log('Categories:');
    
    // Group by category
    const categoryMap = new Map();
    data.data.summary?.forEach(item => {
      const existing = categoryMap.get(item.productCategory);
      if (existing) {
        existing.totalQuantity += item.totalQuantity;
        existing.totalProduced += item.totalProduced || 0;
        existing.requestCount += item.requestCount;
      } else {
        categoryMap.set(item.productCategory, {
          totalQuantity: item.totalQuantity,
          totalProduced: item.totalProduced || 0,
          requestCount: item.requestCount,
        });
      }
    });
    
    categoryMap.forEach((value, key) => {
      console.log(`${key}: ${value.requestCount} items, ${value.totalQuantity} requested, ${value.totalProduced} produced`);
    });
  })
  .catch(e => console.error(e));
