import {
  computed,
  defineComponent,
  SetupContext,
  toRefs,
  ref,
  provide,
  nextTick,
  PropType,
  watch,
  onMounted,
} from '@vue/composition-api';
import pick from 'lodash/pick';
import props from './base-table-props';
import useTableHeader from './hooks/useTableHeader';
import useColumnResize from './hooks/useColumnResize';
import useFixed from './hooks/useFixed';
import usePagination from './hooks/usePagination';
import useVirtualScroll from '../hooks/useVirtualScroll';
import useAffix from './hooks/useAffix';
import Loading from '../loading';
import TBody, { extendTableProps } from './tbody';
import { BaseTableProps } from './interface';
import { useTNodeJSX } from '../hooks/tnode';
import useStyle, { formatCSSUnit } from './hooks/useStyle';
import useClassName from './hooks/useClassName';
import { useConfig } from '../config-provider/useConfig';
import { Affix } from '../affix';
import { ROW_LISTENERS } from './tr';
import THead from './thead';
import TFoot from './tfoot';
import log from '../_common/js/log';
import { getIEVersion } from '../_common/js/utils/helper';
import { getAffixProps } from './utils';
import { Styles } from '../common';
import { BaseTableCol, TableRowData } from './type';

export const BASE_TABLE_EVENTS = ['page-change', 'cell-click', 'scroll', 'scrollX', 'scrollY'];
export const BASE_TABLE_ALL_EVENTS = ROW_LISTENERS.map((t) => `row-${t}`).concat(BASE_TABLE_EVENTS);

export interface TableListeners {
  [key: string]: Function;
}

export default defineComponent({
  name: 'TBaseTable',

  props: {
    ...props,
    renderExpandedRow: Function as PropType<BaseTableProps['renderExpandedRow']>,
    onLeafColumnsChange: Function as PropType<BaseTableProps['onLeafColumnsChange']>,
  },

  setup(props: BaseTableProps, context: SetupContext) {
    const renderTNode = useTNodeJSX();
    const tableRef = ref<HTMLDivElement>();
    const tableElmRef = ref<HTMLTableElement>();
    const tableBodyRef = ref<HTMLTableElement>();
    const tableFootHeight = ref(0);

    const {
      classPrefix, virtualScrollClasses, tableLayoutClasses, tableBaseClass, tableColFixedClasses,
    } = useClassName();
    // 表格基础样式类
    const {
      tableClasses, sizeClassNames, tableContentStyles, tableElementStyles,
    } = useStyle(props);
    const { global } = useConfig('table');
    const { isMultipleHeader, spansAndLeafNodes, thList } = useTableHeader(props);
    const finalColumns = computed(() => spansAndLeafNodes.value?.leafColumns || props.columns);

    // 吸附相关ref 用来做视图resize后重新定位
    const paginationAffixRef = ref();
    const horizontalScrollAffixRef = ref();
    const headerTopAffixRef = ref();
    const footerBottomAffixRef = ref();

    // 固定表头和固定列逻辑
    const {
      scrollbarWidth,
      tableWidth,
      tableElmWidth,
      tableContentRef,
      isFixedHeader,
      isWidthOverflow,
      isFixedColumn,
      thWidthList,
      showColumnShadow,
      rowAndColFixedPosition,
      setData,
      refreshTable,
      emitScrollEvent,
      setUseFixedTableElmRef,
      updateColumnFixedShadow,
      getThWidthList,
      updateThWidthList,
      setRecalculateColWidthFuncRef,
      addTableResizeObserver,
    } = useFixed(props, context, finalColumns, {
      paginationAffixRef,
      horizontalScrollAffixRef,
      headerTopAffixRef,
      footerBottomAffixRef,
    });

    // 1. 表头吸顶；2. 表尾吸底；3. 底部滚动条吸底；4. 分页器吸底
    const {
      affixHeaderRef,
      affixFooterRef,
      horizontalScrollbarRef,
      paginationRef,
      showAffixHeader,
      showAffixFooter,
      showAffixPagination,
      onHorizontalScroll,
      updateAffixHeaderOrFooter,
      setTableContentRef,
    } = useAffix(props);

    const { dataSource, isPaginateData, renderPagination } = usePagination(props, context);

    // 列宽拖拽逻辑
    const columnResizeParams = useColumnResize(tableContentRef, refreshTable, getThWidthList, updateThWidthList);
    const {
      resizeLineRef, resizeLineStyle, recalculateColWidth, setEffectColMap,
    } = columnResizeParams;
    setRecalculateColWidthFuncRef(recalculateColWidth);

    const dynamicBaseTableClasses = computed(() => [
      tableClasses.value,
      {
        [tableBaseClass.headerFixed]: isFixedHeader.value,
        [tableBaseClass.columnFixed]: isFixedColumn.value,
        [tableBaseClass.widthOverflow]: isWidthOverflow.value,
        [tableBaseClass.multipleHeader]: isMultipleHeader.value,
        [tableColFixedClasses.leftShadow]: showColumnShadow.left,
        [tableColFixedClasses.rightShadow]: showColumnShadow.right,
        [tableBaseClass.columnResizableTable]: props.resizable,
      },
    ]);

    const tableElmClasses = computed(() => [
      [tableLayoutClasses[props.tableLayout]],
      { [tableBaseClass.fullHeight]: props.height },
    ]);

    const isVirtual = computed(
      () => props.scroll?.type === 'virtual' && props.data?.length > (props.scroll?.threshold || 100),
    );

    const showRightDivider = computed(
      () => props.bordered
        && isFixedHeader.value
        && ((isMultipleHeader.value && isWidthOverflow.value) || !isMultipleHeader.value),
    );

    const columnResizable = computed(() => props.allowResizeColumnWidth === undefined ? props.resizable : props.allowResizeColumnWidth);

    watch(tableElmRef, () => {
      setUseFixedTableElmRef(tableElmRef.value);
    });

    watch(
      () => [props.data, dataSource, isPaginateData],
      () => {
        setData(isPaginateData.value ? dataSource.value : props.data);
      },
    );

    watch(
      spansAndLeafNodes,
      () => {
        props.onLeafColumnsChange?.(spansAndLeafNodes.value.leafColumns);
        // Vue3 do not need next line
        context.emit('LeafColumnsChange', spansAndLeafNodes.value.leafColumns);
      },
      { immediate: true },
    );

    watch(
      thList,
      () => {
        setEffectColMap(thList.value[0], null);
      },
      {
        immediate: true,
      },
    );

    const onFixedChange = () => {
      nextTick(() => {
        onHorizontalScroll();
        updateAffixHeaderOrFooter();
      });
    };

    // Vue3 do not need getListener
    const getListener = () => {
      const listener: TableListeners = {};
      BASE_TABLE_ALL_EVENTS.forEach((key) => {
        listener[key] = (...args: any) => {
          context.emit(key, ...args);
        };
      });
      return listener;
    };

    // TODO: 这种直接解析 props 的方式，是非响应式的，无法动态设置虚拟滚动，不可如此使用。待改正
    const {
      type, rowHeight, bufferSize = 20, isFixedRowHeight = false,
    } = props.scroll || {};
    const { data } = toRefs<any>(props);
    const {
      trs = null,
      scrollHeight = null,
      visibleData = null,
      translateY = null,
      handleScroll: handleVirtualScroll = null,
      handleRowMounted = null,
    } = type === 'virtual'
      ? useVirtualScroll({
        container: tableContentRef,
        data,
        fixedHeight: isFixedRowHeight,
        lineHeight: rowHeight,
        bufferSize,
        threshold: props.scroll?.threshold,
      })
      : {};
    provide('tableContentRef', tableContentRef);
    provide('rowHeightRef', ref(rowHeight));

    let lastScrollY = 0;
    const onInnerVirtualScroll = (e: WheelEvent) => {
      const target = (e.target || e.srcElement) as HTMLElement;
      const top = target.scrollTop;
      // 排除横向滚动出发的纵向虚拟滚动计算
      if (lastScrollY !== top) {
        isVirtual.value && handleVirtualScroll();
      } else {
        lastScrollY = 0;
        updateColumnFixedShadow(target);
      }
      lastScrollY = top;
      emitScrollEvent(e);
    };

    // used for top margin
    const getTFootHeight = () => {
      if (!tableElmRef.value) return;
      tableFootHeight.value = tableElmRef.value.querySelector('tfoot')?.getBoundingClientRect().height;
    };

    watch(tableContentRef, () => {
      setTableContentRef(tableContentRef.value);
    });

    watch(tableElmRef, getTFootHeight);

    watch(tableRef, (tableRef) => {
      addTableResizeObserver(tableRef);
    });

    onMounted(() => {
      getTFootHeight();
      setTableContentRef(tableContentRef.value);
      addTableResizeObserver(tableRef.value);
    });

    return {
      columnResizable,
      thList,
      classPrefix,
      isVirtual,
      global,
      tableFootHeight,
      tableWidth,
      tableElmWidth,
      tableRef,
      tableElmRef,
      sizeClassNames,
      tableBaseClass,
      spansAndLeafNodes,
      dynamicBaseTableClasses,
      tableContentStyles,
      tableElementStyles,
      virtualScrollClasses,
      tableLayoutClasses,
      tableElmClasses,
      tableContentRef,
      isFixedHeader,
      isWidthOverflow,
      isFixedColumn,
      rowAndColFixedPosition,
      showColumnShadow,
      thWidthList,
      isPaginateData,
      dataSource,
      scrollType: type,
      rowHeight,
      trs,
      bufferSize,
      scrollHeight,
      visibleData,
      translateY,
      affixHeaderRef,
      affixFooterRef,
      paginationRef,
      showAffixHeader,
      showAffixFooter,
      scrollbarWidth,
      isMultipleHeader,
      showRightDivider,
      resizeLineRef,
      resizeLineStyle,
      columnResizeParams,
      horizontalScrollbarRef,
      tableBodyRef,
      showAffixPagination,
      getListener,
      renderPagination,
      renderTNode,
      handleRowMounted,
      onFixedChange,
      onHorizontalScroll,
      updateAffixHeaderOrFooter,
      refreshTable,
      onInnerVirtualScroll,
      paginationAffixRef,
      horizontalScrollAffixRef,
      headerTopAffixRef,
      footerBottomAffixRef,
    };
  },

  methods: {
    renderColGroup(columns: BaseTableCol<TableRowData>[]) {
      const defaultColWidth = this.tableLayout === 'fixed' && this.isWidthOverflow ? '100px' : undefined;
      return (
        <colgroup>
          {columns.map((col) => {
            const style: Styles = {
              width: formatCSSUnit(this.thWidthList[col.colKey] || col.width) || defaultColWidth,
            };
            if (col.minWidth) {
              style.minWidth = formatCSSUnit(col.minWidth);
            }
            return <col key={col.colKey} style={style}></col>;
          })}
        </colgroup>
      );
    },

    getHeadProps() {
      const headProps = {
        isFixedHeader: this.isFixedHeader,
        rowAndColFixedPosition: this.rowAndColFixedPosition,
        isMultipleHeader: this.isMultipleHeader,
        bordered: this.bordered,
        spansAndLeafNodes: this.spansAndLeafNodes,
        thList: this.thList,
        thWidthList: this.thWidthList,
        resizable: this.resizable,
        columnResizeParams: this.columnResizeParams,
        classPrefix: this.classPrefix,
        ellipsisOverlayClassName: this.size !== 'medium' ? this.sizeClassNames[this.size] : '',
      };
      return headProps;
    },

    /**
     * Affixed Header
     */
    renderFixedHeader(columns: BaseTableCol<TableRowData>[]) {
      if (!this.showHeader) return null;
      // onlyVirtualScrollBordered 用于浏览器兼容性处理，只有 chrome 需要调整 bordered，FireFox 和 Safari 不需要
      const onlyVirtualScrollBordered = !!(this.isVirtual && !this.headerAffixedTop && this.bordered) && /Chrome/.test(navigator?.userAgent);
      const borderWidth = this.bordered && onlyVirtualScrollBordered ? 1 : 0;
      const barWidth = this.isWidthOverflow ? this.scrollbarWidth : 0;
      // IE浏览器需要遮挡header吸顶滚动条，要减去getBoundingClientRect.height的滚动条高度4像素
      const IEHeaderWrap = getIEVersion() <= 11 ? 4 : 0;
      const affixHeaderHeight = (this.affixHeaderRef?.getBoundingClientRect().height || 0) - IEHeaderWrap;
      const affixHeaderWrapHeight = affixHeaderHeight - barWidth - borderWidth;
      // 两类场景：1. 虚拟滚动，永久显示表头，直到表头消失在可视区域； 2. 表头吸顶，根据滚动情况判断是否显示吸顶表头
      const headerOpacity = this.headerAffixedTop ? Number(this.showAffixHeader) : 1;
      const affixHeaderWrapHeightStyle = {
        width: `${this.tableWidth}px`,
        height: `${affixHeaderWrapHeight}px`,
        opacity: headerOpacity,
        marginTop: onlyVirtualScrollBordered ? `${borderWidth}px` : 0,
      };
      const colgroup = this.renderColGroup(columns);
      // 多级表头左边线缺失
      const affixedLeftBorder = this.bordered ? 1 : 0;

      const affixedHeader = Boolean((this.headerAffixedTop || this.isVirtual) && this.tableWidth) && (
        <div
          ref="affixHeaderRef"
          style={{ width: `${this.tableWidth - affixedLeftBorder}px`, opacity: headerOpacity }}
          class={['scrollbar', { [this.tableBaseClass.affixedHeaderElm]: this.headerAffixedTop || this.isVirtual }]}
        >
          <table class={this.tableElmClasses} style={{ ...this.tableElementStyles, width: `${this.tableElmWidth}px` }}>
            {colgroup}
            <THead scopedSlots={this.$scopedSlots} props={this.getHeadProps()} />
          </table>
        </div>
      );

      // 添加这一层，是为了隐藏表头的横向滚动条。如果以后不需要照顾 IE 10 以下的项目，则可直接移除这一层
      // 彼时，可更为使用 CSS 样式中的 .hideScrollbar()
      const affixHeaderWithWrap = (
        <div class={this.tableBaseClass.affixedHeaderWrap} style={affixHeaderWrapHeightStyle}>
          {affixedHeader}
        </div>
      );

      return affixHeaderWithWrap;
    },

    /**
     * Affixed Footer
     */
    renderAffixedFooter(columns: BaseTableCol<TableRowData>[]) {
      const barWidth = this.isWidthOverflow ? this.scrollbarWidth : 0;
      // 多级表头左边线缺失
      const affixedLeftBorder = this.bordered ? 1 : 0;
      let marginScrollbarWidth = barWidth;
      if (this.bordered) {
        marginScrollbarWidth += 1;
      }
      // Hack: Affix 组件，marginTop 临时使用 负 margin 定位位置
      const affixedFooter = Boolean(this.footerAffixedBottom && this.footData?.length && this.tableWidth) && (
        <Affix
          class={this.tableBaseClass.affixedFooterWrap}
          onFixedChange={this.onFixedChange}
          offsetBottom={marginScrollbarWidth || 0}
          props={getAffixProps(this.footerAffixedBottom, this.footerAffixProps)}
          style={{ marginTop: `${-1 * (this.tableFootHeight + marginScrollbarWidth)}px` }}
          ref="footerBottomAffixRef"
        >
          <div
            ref="affixFooterRef"
            style={{ width: `${this.tableWidth - affixedLeftBorder}px`, opacity: Number(this.showAffixFooter) }}
            class={[
              'scrollbar',
              { [this.tableBaseClass.affixedFooterElm]: this.footerAffixedBottom || this.isVirtual },
            ]}
          >
            <table
              class={this.tableElmClasses}
              style={{ ...this.tableElementStyles, width: `${this.tableElmWidth}px` }}
            >
              {this.renderColGroup(columns)}
              <TFoot
                rowKey={this.rowKey}
                scopedSlots={this.$scopedSlots}
                isFixedHeader={this.isFixedHeader}
                rowAndColFixedPosition={this.rowAndColFixedPosition}
                footData={this.footData}
                columns={columns}
                rowAttributes={this.rowAttributes}
                rowClassName={this.rowClassName}
                thWidthList={this.thWidthList}
                footerSummary={this.footerSummary}
                rowspanAndColspanInFooter={this.rowspanAndColspanInFooter}
              ></TFoot>
            </table>
          </div>
        </Affix>
      );

      return affixedFooter;
    },

    renderAffixedHeader(columns: BaseTableCol<TableRowData>[]) {
      if (!props.showHeader) return null;
      return (
        !!(this.isVirtual || this.headerAffixedTop)
        && (this.headerAffixedTop ? (
          <Affix
            offsetTop={0}
            props={getAffixProps(this.headerAffixedTop, this.headerAffixProps)}
            onFixedChange={this.onFixedChange}
            ref="headerTopAffixRef"
          >
            {this.renderFixedHeader(columns)}
          </Affix>
        ) : (
          this.isFixedHeader && this.renderFixedHeader(columns)
        ))
      );
    },
  },

  render(h) {
    const { rowAndColFixedPosition } = this;
    const data = this.isPaginateData ? this.dataSource : this.data;
    const columns = this.spansAndLeafNodes?.leafColumns || this.columns;

    if (this.allowResizeColumnWidth) {
      log.warn('Table', 'allowResizeColumnWidth is going to be deprecated, please use resizable instead.');
    }

    if (this.columnResizable && this.tableLayout === 'auto') {
      log.warn('Table', 'table-layout can not be `auto` for resizable column table, set `table-layout: fixed` please.');
    }

    const translate = `translate(0, ${this.scrollHeight}px)`;
    const virtualStyle = {
      transform: translate,
      '-ms-transform': translate,
      '-moz-transform': translate,
      '-webkit-transform': translate,
    };
    const tableBodyProps = {
      rowAndColFixedPosition,
      showColumnShadow: this.showColumnShadow,
      data: this.isVirtual ? this.visibleData : data,
      columns,
      tableElm: this.tableRef,
      tableContentElm: this.tableContentRef,
      tableWidth: this.tableWidth,
      isWidthOverflow: this.isWidthOverflow,
      // 虚拟滚动相关属性
      isVirtual: this.isVirtual,
      translateY: this.translateY,
      scrollType: this.scrollType,
      rowHeight: this.rowHeight,
      trs: this.trs,
      bufferSize: this.bufferSize,
      scroll: this.scroll,
      cellEmptyContent: this.cellEmptyContent,
      classPrefix: this.classPrefix,
      handleRowMounted: this.handleRowMounted,
      renderExpandedRow: this.renderExpandedRow,
      ...pick(this.$props, extendTableProps),
    };
    // Vue3 do not need getListener
    const tBodyListener = this.getListener();
    const tableContent = (
      <div
        ref="tableContentRef"
        class={this.tableBaseClass.content}
        style={this.tableContentStyles}
        on={{ scroll: this.onInnerVirtualScroll }}
      >
        {this.isVirtual && <div class={this.virtualScrollClasses.cursor} style={virtualStyle} />}
        <table ref="tableElmRef" class={this.tableElmClasses} style={this.tableElementStyles}>
          {this.renderColGroup(columns)}
          {this.showHeader && <THead scopedSlots={this.$scopedSlots} props={this.getHeadProps()} />}
          <TBody ref="tableBodyRef" scopedSlots={this.$scopedSlots} props={tableBodyProps} on={tBodyListener} />
          <TFoot
            rowKey={this.rowKey}
            scopedSlots={this.$scopedSlots}
            isFixedHeader={this.isFixedHeader}
            rowAndColFixedPosition={rowAndColFixedPosition}
            footData={this.footData}
            columns={columns}
            rowAttributes={this.rowAttributes}
            rowClassName={this.rowClassName}
            footerSummary={this.footerSummary}
            rowspanAndColspanInFooter={this.rowspanAndColspanInFooter}
          ></TFoot>
        </table>
      </div>
    );

    const customLoadingText = this.renderTNode('loading');
    const loadingContent = this.loading !== undefined && (
      <Loading
        loading={!!this.loading}
        text={customLoadingText ? () => customLoadingText : undefined}
        attach={this.tableRef ? () => this.tableRef : undefined}
        showOverlay
        props={{ size: 'small', ...this.loadingProps }}
      ></Loading>
    );

    const topContent = this.renderTNode('topContent');
    const bottomContent = this.renderTNode('bottomContent');
    const pagination = (
      <div
        ref="paginationRef"
        class={this.tableBaseClass.paginationWrap}
        style={{ opacity: Number(this.showAffixPagination) }}
      >
        {this.renderPagination(h)}
      </div>
    );
    const bottom = !!bottomContent && <div class={this.tableBaseClass.bottomContent}>{bottomContent}</div>;

    return (
      <div ref="tableRef" class={this.dynamicBaseTableClasses} style="position: relative">
        {!!topContent && <div class={this.tableBaseClass.topContent}>{topContent}</div>}

        {this.renderAffixedHeader(columns)}

        {tableContent}

        {this.renderAffixedFooter(columns)}

        {loadingContent}

        {/* 右侧滚动条分隔线 */}
        {this.showRightDivider && (
          <div
            class={this.tableBaseClass.scrollbarDivider}
            style={{
              right: `${this.scrollbarWidth}px`,
              height: `${this.tableContentRef?.getBoundingClientRect().height}px`,
            }}
          ></div>
        )}

        {bottom}

        {/* 吸底的滚动条 */}
        {this.horizontalScrollAffixedBottom && (
          <Affix
            offsetBottom={0}
            props={getAffixProps(this.horizontalScrollAffixedBottom)}
            style={
              this.showAffixFooter
                ? { marginTop: `-${this.scrollbarWidth * 2}px` }
                : { float: 'right', visibility: 'hidden' }
            }
            ref="horizontalScrollAffixRef"
          >
            <div
              ref="horizontalScrollbarRef"
              class={['scrollbar', this.tableBaseClass.obviousScrollbar]}
              style={{
                width: `${this.tableWidth}px`,
                overflow: 'auto',
                opacity: Number(this.showAffixFooter),
              }}
            >
              <div style={{ width: `${this.tableElmWidth}px`, height: '5px' }}></div>
            </div>
          </Affix>
        )}

        {/* 吸底的分页器 */}
        {this.paginationAffixedBottom ? (
          <Affix offsetBottom={0} props={getAffixProps(this.paginationAffixedBottom)} ref="paginationAffixRef">
            {pagination}
          </Affix>
        ) : (
          pagination
        )}

        {/* 调整列宽时的指示线。由于层级需要比较高，因而放在根节点，避免被吸顶表头覆盖。非必要情况，请勿调整辅助线位置 */}
        <div ref="resizeLineRef" class={this.tableBaseClass.resizeLine} style={this.resizeLineStyle}></div>
      </div>
    );
  },
});
