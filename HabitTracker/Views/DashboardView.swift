import SwiftUI

enum DashboardPeriod: String, CaseIterable, Identifiable {
    case daily = "День"
    case weekly = "Неделя"
    case monthly = "Месяц"

    var id: String { rawValue }
}

struct DashboardView: View {
    @StateObject private var service = DashboardService()
    @AppStorage("serverURL") private var serverURL = ""
    @AppStorage("apiToken") private var apiToken = ""
    @State private var isShowingSettings = false
    @State private var period: DashboardPeriod = .daily

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Период", selection: $period) {
                    ForEach(DashboardPeriod.allCases) { period in
                        Text(period.rawValue).tag(period)
                    }
                }
                .pickerStyle(.segmented)
                .padding()

                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle("Дашборд")
            .toolbar {
                ToolbarItem {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Label("Настройки", systemImage: "gearshape")
                    }
                }
                ToolbarItem {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Label("Обновить", systemImage: "arrow.clockwise")
                    }
                }
            }
            .sheet(isPresented: $isShowingSettings) {
                SettingsView()
            }
            .task { await refresh() }
            .onChange(of: period) { _, _ in
                Task { await refresh() }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if service.isLoading && service.participants.isEmpty && service.history.isEmpty {
            ProgressView("Загрузка…")
        } else if let error = service.errorMessage {
            ContentUnavailableView(
                "Не удалось загрузить",
                systemImage: "wifi.exclamationmark",
                description: Text(error)
            )
        } else {
            switch period {
            case .daily:
                DailyRankingView(participants: service.participants)
            case .weekly:
                WeeklyRankingView(participants: service.participants)
            case .monthly:
                MonthlyRankingView(history: service.history)
            }
        }
    }

    private func refresh() async {
        switch period {
        case .daily, .weekly:
            await service.refreshSnapshot(serverURL: serverURL, apiToken: apiToken)
        case .monthly:
            await service.refreshHistory(serverURL: serverURL, apiToken: apiToken)
        }
    }
}
