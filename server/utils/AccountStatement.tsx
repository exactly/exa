import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { format, Logo } from "./Statement";

const styles = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", fontFamily: "Helvetica", paddingBottom: 48 },
  header: { backgroundColor: "#EEF2F0", paddingHorizontal: 48 },
  headerNext: { flexDirection: "row", justifyContent: "center", alignItems: "center", paddingVertical: 14 },
  headerFirst: {
    backgroundColor: "#EEF2F0",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: -56, // HACK react-pdf fixed header overlay marginTop matches headerNext total height 56
    paddingHorizontal: 48,
    paddingVertical: 44,
  },
  headerText: { flex: 1, alignItems: "flex-end" },
  body: { paddingHorizontal: 48, paddingTop: 12 },
  title: { fontSize: 18, fontWeight: "bold", color: "#1B2423" },
  headerDetail: { fontSize: 11, color: "#5D6765", marginTop: 4 },
  cards: { flexDirection: "row", gap: 16, marginTop: 24 },
  card: { backgroundColor: "#EEF2F0", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, flex: 1 },
  cardLabel: { fontSize: 13, fontWeight: "bold", color: "#1B2423" },
  cardDetail: { fontSize: 9, color: "#5D6765", marginTop: 2 },
  cardAmount: { fontSize: 18, fontWeight: "bold", color: "#1B2423", marginTop: 6 },
  sectionTitle: { fontSize: 14, fontWeight: "bold", color: "#1B2423", marginTop: 32 },
  tableHeader: { flexDirection: "row", borderBottom: "1 solid #D8E0DE", paddingBottom: 6, marginTop: 30 },
  headerDate: { width: 90, fontSize: 8, color: "#5D6765", fontWeight: "bold" },
  headerDesc: { flex: 1, fontSize: 8, color: "#5D6765", fontWeight: "bold" },
  headerTotal: { width: 90, fontSize: 8, color: "#5D6765", fontWeight: "bold", textAlign: "right" },
  headerBalance: { width: 100, fontSize: 8, color: "#5D6765", fontWeight: "bold", textAlign: "right" },
  tableRow: { flexDirection: "row", paddingVertical: 8, borderBottom: "1 solid #EEF2F0" },
  colDate: { width: 90, fontSize: 11, color: "#5D6765" },
  movement: { flex: 1 },
  descText: { fontSize: 11, color: "#1B2423" },
  movementDetail: { fontSize: 9, color: "#5D6765", marginTop: 2 },
  colTotal: { width: 90, fontSize: 11, fontWeight: "bold", color: "#1B2423", textAlign: "right" },
  colBalance: { width: 100, fontSize: 11, fontWeight: "bold", color: "#1B2423", textAlign: "right" },
  totalBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#EEF2F0",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    marginTop: -1,
    marginLeft: "auto",
    width: 240,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  totalLabel: { fontSize: 10, fontWeight: "bold", color: "#5D6765" },
  totalAmount: { fontSize: 15, fontWeight: "bold", color: "#1B2423" },
  footer: { position: "absolute", bottom: 24, right: 48, fontSize: 8, color: "#5D6765" },
});

const AccountStatement = ({
  account,
  activities,
  cards,
  period,
}: {
  account: string;
  activities: {
    amount: number;
    detail?: string;
    id: string;
    timestamp: string;
    title: string;
  }[];
  cards: { amount: number; cardId: string; lastFour: string }[];
  period?: string;
}) => {
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const rows = [...activities]
    .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp))
    .reduce<
      ((typeof activities)[number] & { balance: number })[]
    >((accumulator, item) => [...accumulator, { ...item, balance: (accumulator.at(-1)?.balance ?? 0) + item.amount }], []);
  const last = rows.at(-1);
  const total = last?.balance ?? 0;
  const asOf = last === undefined ? undefined : format(last.timestamp);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.headerNext}>
            <Logo width={70} height={28} />
          </View>
        </View>
        <View style={styles.headerFirst}>
          <Logo width={98} height={40} />
          <View style={styles.headerText}>
            <Text style={styles.title}>Account activity</Text>
            <Text style={styles.headerDetail}>
              Account {account}
              {period !== undefined && `\nPeriod ${period}`}
            </Text>
          </View>
        </View>
        <View style={styles.body}>
          <View style={styles.cards}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Account balance</Text>
              {asOf !== undefined && <Text style={styles.cardDetail}>As of {asOf}</Text>}
              <Text style={styles.cardAmount}>{currency.format(total)}</Text>
            </View>
            {cards.map(({ amount, cardId, lastFour }) => (
              <View key={cardId} style={styles.card}>
                <Text style={styles.cardLabel}>Card **** {lastFour}</Text>
                <Text style={styles.cardDetail}>Debit purchases in the period</Text>
                <Text style={styles.cardAmount}>{currency.format(amount)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.sectionTitle}>Account movements</Text>
          <View style={styles.tableHeader} fixed>
            <Text style={styles.headerDate}>DATE</Text>
            <Text style={styles.headerDesc}>MOVEMENT</Text>
            <Text style={styles.headerTotal}>AMOUNT</Text>
            <Text style={styles.headerBalance}>ACCOUNT BALANCE</Text>
          </View>
          {rows.map((item) => (
            <View key={item.id} style={styles.tableRow} wrap={false}>
              <Text style={styles.colDate}>{format(item.timestamp)}</Text>
              <View style={styles.movement}>
                <Text style={styles.descText}>{item.title}</Text>
                {item.detail !== undefined && <Text style={styles.movementDetail}>{item.detail}</Text>}
              </View>
              <Text style={styles.colTotal}>{currency.format(item.amount)}</Text>
              <Text style={styles.colBalance}>{currency.format(item.balance)}</Text>
            </View>
          ))}
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>TOTAL BALANCE</Text>
            <Text style={styles.totalAmount}>{currency.format(total)}</Text>
          </View>
        </View>
        <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${pageNumber} · ${totalPages}`} />
      </Page>
    </Document>
  );
};

export default AccountStatement;
