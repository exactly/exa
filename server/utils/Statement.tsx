import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";

const styles = StyleSheet.create({
  page: { flexDirection: "column", backgroundColor: "#FBFDFC", padding: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    paddingBottom: 16,
    borderBottom: "1px solid #E6E9E8",
  },
  headerLeft: { flex: 1 },
  headerRight: { alignItems: "flex-end" },
  appTitle: { fontSize: 24, fontWeight: "bold", color: "#1A211E", marginBottom: 4 },
  title: { fontSize: 18, fontWeight: "600", color: "#1A211E" },
  subtitle: { fontSize: 14, color: "#5F6563" },
  discountChip: {
    backgroundColor: "#E0F8F3",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  discountText: { fontSize: 10, color: "#008573", fontWeight: "500" },
  sectionHeader: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1A211E",
    marginTop: 8,
    marginBottom: 8,
    paddingLeft: 4,
  },
  activityItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    padding: 16,
    marginBottom: 8,
    borderRadius: 8,
    border: "1px solid #EEF1F0",
  },
  iconContainer: {
    width: 40,
    height: 40,
    backgroundColor: "#EEF1F0",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  iconText: { fontSize: 16, color: "#1A211E", fontWeight: "bold" },
  contentContainer: { flex: 1, marginRight: 16 },
  primaryText: { fontSize: 15, fontWeight: "600", color: "#1A211E", marginBottom: 4 },
  secondaryText: { fontSize: 13, color: "#5F6563" },
  amountContainer: { alignItems: "flex-end" },
  amountText: { fontSize: 15, fontWeight: "600", color: "#1A211E", marginBottom: 4 },
  currencyText: { fontSize: 13, color: "#5F6563" },
  installmentContainer: { marginLeft: 16, marginTop: 8, paddingLeft: 16, borderLeft: "2px solid #EEF1F0" },
  installmentText: { fontSize: 13, color: "#5F6563", marginBottom: 4 },
  dateHeader: { fontSize: 15, fontWeight: "600", color: "#5F6563", marginTop: 24, marginBottom: 12, paddingLeft: 4 },
  infoSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: "1px solid #EEF1F0",
  },
  infoColumn: { flex: 1 },
  infoRow: { flexDirection: "row", marginBottom: 6 },
  infoLabel: { fontSize: 13, fontWeight: "600", color: "#5F6563", width: 80 },
  infoValue: { fontSize: 13, color: "#1A211E", flex: 1 },
  cardNumber: { fontSize: 13, color: "#1A211E", flex: 1, fontFamily: "Courier" },
});

const Statement = (statement: {
  data: (
    | {
        amount: number;
        discount: number;
        positionAmount: number;
        timestamp: string;
      }
    | { description: string; installments: { amount: number; current: number; total: number }[]; timestamp: string }
  )[];
  lastFour: string;
  maturity: number;
}) => {
  const repayments = statement.data.filter(
    (
      item,
    ): item is {
      amount: number;
      discount: number;
      positionAmount: number;
      timestamp: string;
    } => "positionAmount" in item,
  );
  const purchases = statement.data.filter(
    (
      item,
    ): item is {
      description: string;
      installments: { amount: number; current: number; total: number }[];
      timestamp: string;
    } => "description" in item,
  );
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.appTitle}>Exa App</Text>
            <Text style={styles.title}>Card Statement</Text>
          </View>
        </View>
        <View style={styles.infoSection}>
          <View style={styles.infoColumn}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Id:</Text>
              <Text style={styles.cardNumber}>{statement.maturity}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Date:</Text>
              <Text style={styles.cardNumber}>{new Date(statement.maturity * 1000).toLocaleDateString("en-CA")}</Text>
            </View>
          </View>
          <View style={styles.infoColumn}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Card No.:</Text>
              <Text style={styles.cardNumber}>**** **** **** {statement.lastFour}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Due date:</Text>
              <Text style={styles.cardNumber}>{new Date(statement.maturity * 1000).toLocaleDateString("en-CA")}</Text>
            </View>
          </View>
        </View>
        {repayments.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Payments</Text>
            {repayments.map((item, index) => (
              <View key={index}>
                <View style={styles.activityItem}>
                  <View style={styles.contentContainer}>
                    <Text style={styles.installmentText}>{new Date(item.timestamp).toLocaleDateString("en-CA")}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={styles.discountChip}>
                        <Text style={styles.discountText}>{item.discount.toFixed(2)}% discount applied</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.amountContainer}>
                    <Text style={styles.amountText}>USDC {item.amount.toFixed(2)}</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}
        {purchases.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Purchases</Text>
            {purchases.map((item, index) => (
              <View key={index}>
                <View style={styles.activityItem}>
                  <View style={styles.contentContainer}>
                    <Text style={styles.installmentText}>{new Date(item.timestamp).toLocaleDateString("en-CA")}</Text>
                    <Text style={styles.primaryText}>{item.description}</Text>
                    {item.installments.map((installment, index_) => {
                      const { current, total } = installment;
                      return (
                        <Text key={index_} style={styles.installmentText}>
                          Installment {current} of {total}
                        </Text>
                      );
                    })}
                  </View>
                  <View style={styles.amountContainer}>
                    <Text style={styles.amountText}>
                      USDC {item.installments.reduce((sum, inst) => sum + inst.amount, 0).toFixed(2)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}
      </Page>
    </Document>
  );
};

export default Statement;
