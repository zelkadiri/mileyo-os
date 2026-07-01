import db from "../app/db.server";

const main = async () => {
  const selections = await db.subscriptionMealSelection.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  const boxOrders = await db.boxOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  console.log("=== SubscriptionMealSelection ===");
  console.log(JSON.stringify(selections, null, 2));
  console.log("\n=== BoxOrder ===");
  console.log(JSON.stringify(boxOrders, null, 2));
};

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
