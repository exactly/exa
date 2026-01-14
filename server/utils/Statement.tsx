import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";

import { MATURITY_INTERVAL } from "@exactly/lib";

const Statement = ({
  data,
  lastFour,
  maturity,
}: {
  data: (
    | {
        amount: number;
        currency: string;
        id: string;
        positionAmount: number;
        timestamp: string;
      }
    | {
        description: string;
        id: string;
        installments: { amount: number; current: number; total: number }[];
        timestamp: string;
      }
  )[];
  lastFour: string;
  maturity: number;
}) => {
  const dueDate = format(maturity);
  const statementDate = format(maturity - MATURITY_INTERVAL);
  const repayments = data.filter(
    (
      item,
    ): item is {
      amount: number;
      currency: string;
      id: string;
      positionAmount: number;
      timestamp: string;
    } => "positionAmount" in item,
  );
  const purchases = data.filter(
    (
      item,
    ): item is {
      description: string;
      id: string;
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
              <Text style={styles.cardNumber}>{maturity}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Date:</Text>
              <Text style={styles.cardNumber}>{statementDate}</Text>
            </View>
          </View>
          <View style={styles.infoColumn}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Card No.:</Text>
              <Text style={styles.cardNumber}>**** **** **** {lastFour}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Due date:</Text>
              <Text style={styles.cardNumber}>{dueDate}</Text>
            </View>
          </View>
        </View>
        {repayments.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Payments</Text>
            {repayments.map((item) => {
              const percent =
                item.positionAmount === 0 ? 0 : ((item.positionAmount - item.amount) / item.positionAmount) * 100;
              return (
                <View key={item.id}>
                  <View style={styles.activityItem}>
                    <View style={styles.contentContainer}>
                      <Text style={styles.installmentText}>{new Date(item.timestamp).toISOString().slice(0, 10)}</Text>
                      {percent !== 0 && (
                        <View style={styles.discountChipContainer}>
                          <View style={percent > 0 ? styles.discountChip : styles.penaltyChip}>
                            <Text style={percent > 0 ? styles.discountText : styles.penaltyText}>
                              {Math.abs(percent).toFixed(2)}% {percent > 0 ? "discount" : "penalty"} applied
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>
                    <View style={styles.amountContainer}>
                      <Text style={styles.amountText}>
                        {item.currency} {item.amount.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </>
        )}
        {purchases.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Purchases</Text>
            {purchases.map((item) => (
              <View key={item.id}>
                <View style={styles.activityItem}>
                  <View style={styles.contentContainer}>
                    <Text style={styles.installmentText}>{new Date(item.timestamp).toISOString().slice(0, 10)}</Text>
                    <Text style={styles.primaryText}>{item.description}</Text>
                    {item.installments.map((installment) => {
                      const { current, total } = installment;
                      return (
                        <Text key={current} style={styles.installmentText}>
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

function format(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

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
  appTitle: { fontSize: 24, fontWeight: "bold", color: "#1A211E", marginBottom: 4 },
  title: { fontSize: 18, fontWeight: "600", color: "#1A211E" },
  discountChipContainer: { flexDirection: "row", alignItems: "center", gap: 6 },
  discountChip: {
    backgroundColor: "#E0F8F3",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  discountText: { fontSize: 10, color: "#008573", fontWeight: "500" },
  penaltyChip: {
    backgroundColor: "#FDE8EA",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  penaltyText: { fontSize: 10, color: "#C03445", fontWeight: "500" },
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
  contentContainer: { flex: 1, marginRight: 16 },
  primaryText: { fontSize: 15, fontWeight: "600", color: "#1A211E", marginBottom: 4 },
  amountContainer: { alignItems: "flex-end" },
  amountText: { fontSize: 15, fontWeight: "600", color: "#1A211E", marginBottom: 4 },
  installmentText: { fontSize: 13, color: "#5F6563", marginBottom: 4 },
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
  cardNumber: { fontSize: 13, color: "#1A211E", flex: 1, fontFamily: "Courier" },
});
