import { Document, G, Page, Path, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";

import { MATURITY_INTERVAL } from "@exactly/lib";

const Statement = ({
  account,
  cards,
  maturity,
  payments,
}: {
  account: string;
  cards: {
    id: string;
    lastFour: string;
    purchases: {
      description: string;
      id: string;
      installments: { amount: number; current: number; total: number }[];
      timestamp: string;
    }[];
  }[];
  maturity: number;
  payments: { amount: number; id: string; positionAmount: number; timestamp: string }[];
}) => {
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

  const totalSpent = cards.reduce(
    (sum, card) =>
      sum +
      card.purchases.reduce((s, p) => s + p.installments.reduce((a, installment) => a + installment.amount, 0), 0),
    0,
  );
  const totalPayments = payments.reduce((sum, p) => sum + p.positionAmount, 0);
  const dueBalance = totalSpent - totalPayments;
  const periodStart = format((maturity - MATURITY_INTERVAL) * 1000);
  const periodEnd = format(maturity * 1000);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Svg width={133} height={54} viewBox="85 182 335 136">
              <Rect x="89.8" y="186.1" width="127.6" height="127.6" rx="8.5" ry="8.5" fill="#19181a" />
              <G>
                <Path
                  fill="#fbfdfc"
                  d="M128,242.7h51c1.6,0,2.8,1.3,2.8,2.8v8.5c0,1.6-1.3,2.8-2.8,2.8h-51c-1.6,0-2.8-1.3-2.8-2.8v-8.5c0-1.6,1.3-2.8,2.8-2.8Z"
                />
                <Path
                  fill="#fbfdfc"
                  d="M193.2,207.3h-79.4c-1.6,0-2.8,1.3-2.8,2.8v15.6c0,1.6,1.3,2.8,2.8,2.8h8.5c1.6,0,2.8-1.3,2.8-2.8v-4.3h56.7v4.3c0,1.6,1.3,2.8,2.8,2.8h8.5c1.6,0,2.8-1.3,2.8-2.8v-15.6c0-1.6-1.3-2.8-2.8-2.8Z"
                />
                <Path
                  fill="#fbfdfc"
                  d="M193.2,271.1h-8.5c-1.6,0-2.8,1.3-2.8,2.8v4.3h-56.7v-4.3c0-1.6-1.3-2.8-2.8-2.8h-8.5c-1.6,0-2.8,1.3-2.8,2.8v15.6c0,1.6,1.3,2.8,2.8,2.8h79.4c1.6,0,2.8-1.3,2.8-2.8v-15.6c0-1.6-1.3-2.8-2.8-2.8Z"
                />
              </G>
              <G>
                <Path fill="#19181a" d="M256.5,221.6h42.8v11.3h-26v11h24v10.8h-24v11.5h26v11.3h-42.8v-56Z" />
                <Path
                  fill="#19181a"
                  d="M318.3,253l-15.2-24.6h18.8l8.6,17.9,8.3-17.9h18.6l-15.3,24.6,15.6,24.6h-18.8l-9-17.9-8.7,17.9h-18.6l15.8-24.6Z"
                />
                <Path
                  fill="#19181a"
                  d="M369.4,277.4c-2.5-.5-4.6-1.4-6.3-2.5-1.7-1.2-3-2.8-3.9-4.8s-1.3-4.5-1.3-7.4.4-5.1,1.2-7c.8-1.9,2-3.4,3.7-4.6,1.6-1.2,3.7-2,6.2-2.6s5.4-.8,8.7-.8h15.3v-1.5c0-1.9-.4-3.3-1.1-4.4-.7-1.1-1.7-1.8-3.1-2.3-1.3-.5-2.9-.7-4.8-.7s-2.7.2-4,.6c-1.3.4-2.4,1.1-3.3,2-.9,1-1.6,2.3-2.1,4l-16.2-4.6c.6-2.4,1.8-4.5,3.4-6.2,1.6-1.7,3.6-3,5.9-4s4.8-1.8,7.6-2.2c2.8-.5,5.7-.7,8.6-.7,5.6,0,10.3.6,14.2,1.9s6.7,3.3,8.7,6.1c2,2.8,2.9,6.6,2.9,11.3v30.4h-13.8l-1.5-5.4c-.5.8-1.3,1.5-2.3,2.2-1,.7-2.3,1.3-3.8,1.9-1.5.6-3.1,1-4.9,1.3-1.8.3-3.7.5-5.7.5-3.2,0-6-.3-8.5-.8ZM386.4,267.1c1.5-.4,2.8-.9,4-1.5,1.1-.6,2-1.3,2.6-2.1v-6.9h-11.1c-1.1,0-2.1,0-3,.2-.9.2-1.6.4-2.2.8-.6.4-1,.9-1.3,1.6s-.5,1.7-.5,2.8.2,2.1.5,2.8c.3.7.8,1.3,1.4,1.7.6.4,1.3.7,2.2.9.9.2,1.8.2,2.8.2,1.6,0,3.2-.2,4.7-.5Z"
                />
              </G>
            </Svg>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.title}>Statement</Text>
            <Text style={styles.headerDetail}>
              <Text style={styles.headerLabel}>Account </Text>
              {account}
            </Text>
            <Text style={styles.headerDetail}>
              <Text style={styles.headerLabel}>Date </Text>
              {periodStart}
            </Text>
          </View>
        </View>
        <View style={styles.infoBar}>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Period</Text>
            <Text style={styles.infoValue}>
              {periodStart} to {periodEnd}
            </Text>
          </View>
          <View style={styles.infoCellBorder}>
            <Text style={styles.infoLabel}>Due date</Text>
            <Text style={styles.infoValue}>{periodEnd}</Text>
          </View>
          <View style={styles.infoCellBorder}>
            <Text style={styles.infoLabel}>Total spent</Text>
            <Text style={styles.infoValue}>{currency.format(totalSpent)}</Text>
          </View>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryTitle}>Summary</Text>
          {cards.map((card) => {
            const cardTotal = card.purchases.reduce(
              (sum, p) => sum + p.installments.reduce((a, installment) => a + installment.amount, 0),
              0,
            );
            return (
              <View key={card.id} style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Card **** {card.lastFour} purchases</Text>
                <View style={styles.summaryLeader} />
                <Text style={styles.summaryAmount}>{currency.format(cardTotal)}</Text>
              </View>
            );
          })}
          {payments.length > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Payments</Text>
              <View style={styles.summaryLeader} />
              <Text style={styles.summaryAmount}>-{currency.format(totalPayments)}</Text>
            </View>
          )}
          <View style={styles.summaryDueRow}>
            <Text style={styles.summaryLabel}>Due balance</Text>
            <Text style={styles.summaryAmount}>{currency.format(dueBalance)}</Text>
          </View>
        </View>
        {cards.map((card) => {
          const cardTotal = card.purchases.reduce(
            (sum, p) => sum + p.installments.reduce((a, installment) => a + installment.amount, 0),
            0,
          );
          return (
            <View key={card.id} style={styles.section}>
              <Text style={styles.sectionHeader}>Card **** {card.lastFour} purchases</Text>
              <View style={styles.tableHeader}>
                <Text style={styles.headerDate}>DATE</Text>
                <Text style={styles.headerDesc}>DESCRIPTION</Text>
                <Text style={styles.headerInst}>INSTALLMENTS</Text>
                <Text style={styles.headerTotal}>TOTAL</Text>
              </View>
              {card.purchases.map((purchase) => (
                <View key={purchase.id} style={styles.tableRow}>
                  <Text style={styles.colDate}>{format(purchase.timestamp)}</Text>
                  <Text style={styles.colDesc}>{purchase.description}</Text>
                  <Text style={styles.colInst}>
                    {purchase.installments
                      .map((installment) => `${installment.current} of ${installment.total}`)
                      .join(", ")}
                  </Text>
                  <Text style={styles.colTotal}>
                    {currency.format(purchase.installments.reduce((sum, installment) => sum + installment.amount, 0))}
                  </Text>
                </View>
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.colDate} />
                <Text style={styles.totalLabel}>Total spent on card **** {card.lastFour}</Text>
                <Text style={styles.colInst} />
                <Text style={styles.totalAmount}>{currency.format(cardTotal)}</Text>
              </View>
            </View>
          );
        })}
        {payments.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Payments</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.headerDate}>DATE</Text>
              <Text style={styles.headerDesc}>DESCRIPTION</Text>
              <Text style={styles.headerTotal}>TOTAL</Text>
            </View>
            {payments.map((payment) => {
              const percent =
                payment.positionAmount === 0
                  ? 0
                  : ((payment.positionAmount - payment.amount) / payment.positionAmount) * 100;
              return (
                <View key={payment.id} style={styles.tableRow}>
                  <Text style={styles.colDate}>{format(payment.timestamp)}</Text>
                  <View style={styles.colDescRow}>
                    <Text style={styles.descText}>Payment</Text>
                    {percent >= 0.01 && (
                      <View style={styles.discountChip}>
                        <Text style={styles.discountText}>{percent.toFixed(2)}% discount</Text>
                      </View>
                    )}
                    {percent <= -0.01 && (
                      <View style={styles.penaltyChip}>
                        <Text style={styles.penaltyText}>{Math.abs(percent).toFixed(2)}% penalty</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.colTotal}>-{currency.format(payment.positionAmount)}</Text>
                </View>
              );
            })}
            <View style={styles.totalRow}>
              <Text style={styles.colDate} />
              <Text style={styles.totalLabel}>Payments total</Text>
              <Text style={styles.totalAmount}>-{currency.format(totalPayments)}</Text>
            </View>
          </View>
        )}
        <View style={styles.dueBar}>
          <Text style={styles.dueLabel}>Due balance</Text>
          <Text style={styles.dueAmount}>{currency.format(dueBalance)}</Text>
        </View>
      </Page>
    </Document>
  );
};

export default Statement;

export function format(value: number | string) {
  return new Date(value).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  page: { flexDirection: "column", backgroundColor: "#FBFDFC", padding: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
    paddingBottom: 16,
    borderBottom: "1px solid #E6E9E8",
  },
  headerLeft: { flex: 1 },
  headerRight: { alignItems: "flex-end" },
  title: { fontSize: 18, fontWeight: "600", color: "#1A211E", marginBottom: 4 },
  headerDetail: { fontSize: 11, color: "#5F6563", marginBottom: 2 },
  headerLabel: { fontWeight: "bold", color: "#5F6563" },
  infoBar: {
    flexDirection: "row",
    marginBottom: 16,
    borderRadius: 8,
    border: "1px solid #EEF1F0",
    backgroundColor: "#F3F5F4",
  },
  infoCell: { flex: 1, padding: 12 },
  infoCellBorder: { flex: 1, padding: 12, borderLeft: "1px solid #EEF1F0" },
  infoLabel: { fontSize: 10, color: "#5F6563", marginBottom: 4 },
  infoValue: { fontSize: 12, color: "#1A211E" },
  summaryBox: {
    marginBottom: 16,
    paddingTop: 16,
    paddingHorizontal: 16,
    borderRadius: 8,
    border: "1px solid #EEF1F0",
    backgroundColor: "#FFFFFF",
  },
  summaryTitle: { fontSize: 14, fontWeight: "bold", color: "#1A211E", marginBottom: 8 },
  summaryRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 4 },
  summaryLeader: { flex: 1, borderBottom: "1px dotted #C0C0C0", marginHorizontal: 4, marginBottom: 3 },
  summaryLabel: { fontSize: 12, color: "#1A211E" },
  summaryAmount: { fontSize: 12, color: "#1A211E" },
  summaryDueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
    marginHorizontal: -16,
    backgroundColor: "#F3F5F4",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    marginTop: 12,
  },
  section: { marginBottom: 16 },
  sectionHeader: { fontSize: 14, fontWeight: "bold", color: "#1A211E", marginBottom: 8 },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottom: "1px solid #E6E9E8",
    marginBottom: 4,
    fontSize: 11,
    color: "#5F6563",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  colDate: { width: 100, fontSize: 11, color: "#5F6563" },
  colDesc: { flex: 1, fontSize: 11, color: "#1A211E" },
  colDescRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  descText: { fontSize: 11, color: "#1A211E" },
  discountChip: { backgroundColor: "#E6F4EA", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  discountText: { fontSize: 9, color: "#1B7D3A" },
  penaltyChip: { backgroundColor: "#FDE8E8", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  penaltyText: { fontSize: 9, color: "#C5221F" },
  colInst: { width: 100, fontSize: 11, color: "#1A211E", textAlign: "center" },
  colTotal: { width: 90, fontSize: 11, color: "#1A211E", textAlign: "right" },
  headerDate: { width: 100, fontSize: 11, color: "#5F6563" },
  headerDesc: { flex: 1, fontSize: 11, color: "#5F6563" },
  headerInst: { width: 100, fontSize: 11, color: "#5F6563", textAlign: "center" },
  headerTotal: { width: 90, fontSize: 11, color: "#5F6563", textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderTop: "1px solid #E6E9E8",
    marginTop: 4,
  },
  totalLabel: { flex: 1, fontSize: 11, color: "#1A211E" },
  totalAmount: { width: 90, fontSize: 11, color: "#1A211E", textAlign: "right" },
  dueBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#1A211E",
    borderRadius: 8,
    marginTop: 8,
  },
  dueLabel: { fontSize: 14, fontWeight: "bold", color: "#FFFFFF" },
  dueAmount: { fontSize: 14, fontWeight: "bold", color: "#FFFFFF" },
});
