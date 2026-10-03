import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { Logo } from "./Statement";

const date = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" });

const styles = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", paddingBottom: 48 },
  header: { backgroundColor: "#EEF1F0", paddingHorizontal: 56.625 },
  headerNext: { flexDirection: "row", justifyContent: "center", alignItems: "center", height: 58 },
  headerFirst: {
    backgroundColor: "#EEF1F0",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    height: 139,
    marginTop: -58,
    paddingHorizontal: 56.625,
  },
  headerLogoFirst: { marginTop: 14 },
  headerText: { flex: 1, alignItems: "flex-end", marginTop: 22 },
  title: { fontSize: 18, fontWeight: "600", color: "#000000" },
  headerDetail: { fontSize: 12, color: "#5F6462", marginTop: 2, textAlign: "right" },
  headerLabel: { fontWeight: "bold" },
  body: { paddingHorizontal: 56.625 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 11.325, marginTop: 39.5 },
  card: {
    backgroundColor: "#EEF1F0",
    borderRadius: 4,
    height: 80.625,
    paddingHorizontal: 11.375,
    paddingTop: 8.6,
    width: 235.35,
  },
  cardLabel: { fontSize: 14, fontWeight: "bold", color: "#1A201E" },
  cardDetail: { fontSize: 10, color: "#5F6462", marginTop: 1 },
  cardAmount: { fontFamily: "Courier", fontSize: 16, fontWeight: "bold", color: "#1A201E", marginTop: 8.5 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#000000",
    marginHorizontal: 11.375,
    marginTop: 37,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "0.566 solid #EEF1F0",
    paddingHorizontal: 11.375,
    paddingBottom: 10.3,
    marginTop: 16,
  },
  tableLabel: { fontSize: 7.333, fontWeight: "bold", color: "#5F6462" },
  headerDate: { width: 65.333 },
  headerDesc: { flex: 1 },
  headerTotal: { width: 90, textAlign: "right" },
  tableRow: { flexDirection: "row", paddingHorizontal: 11.375 },
  tableRowSingle: { paddingVertical: 6.05 },
  tableRowDouble: { paddingVertical: 5.9 },
  movement: { flex: 1 },
  colDate: { width: 65.333, fontSize: 9.333, color: "#5F6462" },
  descText: { fontSize: 10, color: "#1A201E", maxLines: 1, textOverflow: "ellipsis" },
  movementDetail: { fontSize: 8, color: "#828282", marginTop: 2, maxLines: 1, textOverflow: "ellipsis" },
  colTotal: {
    width: 90,
    fontFamily: "Courier",
    fontSize: 10,
    fontWeight: "bold",
    color: "#1A201E",
    textAlign: "right",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    right: 68,
    fontSize: 7.333,
    fontWeight: "bold",
    color: "#5F6462",
  },
});

export default function AccountStatement({
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
}) {
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const rows = [...activities].toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
  return (
    <Document>
      <Page size={[595.28, 958.129]} style={styles.page}>
        {Header({ account, first: true, period })}
        <View style={styles.body}>
          {Summary({ cards, currency, period })}
          <View wrap={false}>
            <Text style={styles.sectionTitle}>Account movements</Text>
            {TableHeader()}
            {rows[0] !== undefined && MovementRow({ currency, item: rows[0] })}
          </View>
          <View fixed render={({ pageNumber }) => (pageNumber === 1 ? null : TableHeader())} />
          {rows.slice(1).map((item) => MovementRow({ currency, item }))}
        </View>
        {Footer()}
      </Page>
    </Document>
  );
}

function Summary({
  cards,
  currency,
  period,
}: {
  cards: { amount: number; cardId: string; lastFour: string }[];
  currency: Intl.NumberFormat;
  period?: string;
}) {
  return (
    <View style={styles.cards}>
      {cards.map(({ amount, cardId, lastFour }) => (
        <View key={cardId} style={styles.card}>
          <Text style={styles.cardLabel}>Card **** {lastFour}</Text>
          {period !== undefined && <Text style={styles.cardDetail}>Debit purchases in the period</Text>}
          <Text style={styles.cardAmount}>{currency.format(amount)}</Text>
        </View>
      ))}
    </View>
  );
}

function TableHeader() {
  return (
    <View style={styles.tableHeader}>
      <Text style={[styles.tableLabel, styles.headerDate]}>DATE</Text>
      <Text style={[styles.tableLabel, styles.headerDesc]}>MOVEMENT</Text>
      <Text style={[styles.tableLabel, styles.headerTotal]}>AMOUNT</Text>
    </View>
  );
}

function Header({ account, first = false, period }: { account: string; first?: boolean; period?: string }) {
  return (
    <>
      <View style={styles.header} fixed>
        <View style={styles.headerNext}>
          <Logo width={70} height={28} />
        </View>
      </View>
      {first && (
        <View style={styles.headerFirst}>
          <View style={styles.headerLogoFirst}>
            <Logo width={98} height={40} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Account activity</Text>
            <Text style={styles.headerDetail}>
              <Text style={styles.headerLabel}>Account </Text>
              {account}
              {period !== undefined && (
                <>
                  {"\n"}
                  <Text style={styles.headerLabel}>Period </Text>
                  {period}
                </>
              )}
            </Text>
          </View>
        </View>
      )}
    </>
  );
}

function Footer() {
  return <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${pageNumber} • ${totalPages}`} />;
}

function MovementRow({
  currency,
  item,
}: {
  currency: Intl.NumberFormat;
  item: { amount: number; detail?: string; id: string; timestamp: string; title: string };
}) {
  return (
    <View
      key={item.id}
      style={[styles.tableRow, item.detail === undefined ? styles.tableRowSingle : styles.tableRowDouble]}
      wrap={false}
    >
      <Text style={styles.colDate}>{date.format(Date.parse(item.timestamp))}</Text>
      <View style={styles.movement}>
        <Text style={styles.descText}>{item.title}</Text>
        {item.detail !== undefined && <Text style={styles.movementDetail}>{item.detail}</Text>}
      </View>
      <Text style={styles.colTotal}>{currency.format(item.amount)}</Text>
    </View>
  );
}
